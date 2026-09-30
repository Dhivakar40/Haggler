import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  applyToCampusSchema,
  campusDecisionSchema,
  createCampusListingSchema,
  studentProfileUpdateSchema,
  updateCampusListingSchema,
} from '@haggler/shared';
import { z } from 'zod';
import { ApiZodBody, CurrentUser, Roles, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { CampusApplicationsService } from './campus-applications.service';
import { CampusListingsService } from './campus-listings.service';
import { StudentProfileService } from './student-profile.service';

const id = new ZodPipe(z.string().uuid());
const listQuery = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const browseQuery = listQuery.extend({
  categorySlug: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
});
/** Only the institute name is patchable after creation; the DOB is set once via POST. */
const studentInstituteSchema = z.object({ instituteName: z.string().trim().max(120).optional() });

@ApiTags('student')
@ApiBearerAuth()
@Roles('STUDENT')
@Controller({ path: 'student/profile', version: '1' })
export class StudentProfileController {
  constructor(private readonly students: StudentProfileService) {}

  @Get()
  @ApiOperation({ summary: 'My student profile' })
  get(@CurrentUser() u: AuthUser) {
    return this.students.get(u.id);
  }

  @Post()
  @ApiOperation({
    summary: 'Set my date of birth once (hard-blocked under 18) and my institute name',
  })
  @ApiZodBody(studentProfileUpdateSchema)
  create(
    @CurrentUser() u: AuthUser,
    @Body(new ZodPipe(studentProfileUpdateSchema)) body: z.infer<typeof studentProfileUpdateSchema>,
  ) {
    return this.students.create(u.id, body);
  }

  @Patch()
  @ApiOperation({ summary: 'Update my institute name (the date of birth cannot be changed here)' })
  @ApiZodBody(studentInstituteSchema)
  update(
    @CurrentUser() u: AuthUser,
    @Body(new ZodPipe(studentInstituteSchema)) body: z.infer<typeof studentInstituteSchema>,
  ) {
    return this.students.updateInstitute(u.id, body.instituteName);
  }
}

@ApiTags('employer')
@ApiBearerAuth()
@Roles('EMPLOYER')
@Controller({ path: 'employer/campus', version: '1' })
export class EmployerCampusController {
  constructor(
    private readonly listings: CampusListingsService,
    private readonly applications: CampusApplicationsService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Post a Campus (part-time student) listing — needs a verified employer',
  })
  @ApiZodBody(createCampusListingSchema)
  create(
    @CurrentUser() u: AuthUser,
    @Body(new ZodPipe(createCampusListingSchema)) body: z.infer<typeof createCampusListingSchema>,
  ) {
    return this.listings.create(u.id, body);
  }

  @Get()
  @ApiOperation({ summary: 'My Campus listings, newest first' })
  mine(@CurrentUser() u: AuthUser, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.listings.mine(u.id, q.cursor, q.limit);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a listing, or change its status (pause/reopen/close/cancel)' })
  @ApiZodBody(updateCampusListingSchema)
  update(
    @CurrentUser() u: AuthUser,
    @Param('id', id) listingId: string,
    @Body(new ZodPipe(updateCampusListingSchema)) body: z.infer<typeof updateCampusListingSchema>,
  ) {
    return this.listings.update(u.id, listingId, body);
  }

  @Get(':id/applications')
  @ApiOperation({ summary: 'Every applicant for one of my Campus listings' })
  listApplications(
    @CurrentUser() u: AuthUser,
    @Param('id', id) listingId: string,
    @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>,
  ) {
    return this.applications.forListing(u.id, listingId, q.cursor, q.limit);
  }

  @Post(':id/boost')
  @ApiOperation({
    summary: 'Pay a Boosted Listing fee for higher placement (D-069): creates a payment order',
  })
  boost(@CurrentUser() u: AuthUser, @Param('id', id) listingId: string) {
    return this.listings.boost(u.id, listingId);
  }

  @Post(':id/applications/:appId/decision')
  @ApiOperation({
    summary: 'Shortlist, reject or hire an applicant (re-checks the weekly hours cap on hire)',
  })
  @ApiZodBody(campusDecisionSchema)
  decide(
    @CurrentUser() u: AuthUser,
    @Param('id', id) listingId: string,
    @Param('appId', id) applicationId: string,
    @Body(new ZodPipe(campusDecisionSchema)) body: z.infer<typeof campusDecisionSchema>,
  ) {
    return this.applications.decide(u.id, listingId, applicationId, body);
  }
}

@ApiTags('campus')
@ApiBearerAuth()
@Controller({ path: 'campus', version: '1' })
export class CampusController {
  constructor(
    private readonly listings: CampusListingsService,
    private readonly applications: CampusApplicationsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Browse open Campus listings' })
  browse(
    @CurrentUser() u: AuthUser,
    @Query(new ZodPipe(browseQuery)) q: z.infer<typeof browseQuery>,
  ) {
    return this.listings.browse(
      u.id,
      { categorySlug: q.categorySlug, city: q.city },
      q.cursor,
      q.limit,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Listing detail' })
  detail(@CurrentUser() u: AuthUser, @Param('id', id) listingId: string) {
    return this.listings.detail(u.id, listingId);
  }

  @Post(':id/apply')
  @Roles('STUDENT')
  @ApiOperation({ summary: 'Apply to a listing (opt into night shifts explicitly if it has any)' })
  @ApiZodBody(applyToCampusSchema)
  apply(
    @CurrentUser() u: AuthUser,
    @Param('id', id) listingId: string,
    @Body(new ZodPipe(applyToCampusSchema)) body: z.infer<typeof applyToCampusSchema>,
  ) {
    return this.applications.apply(u.id, listingId, body);
  }

  @Delete(':id/apply')
  @Roles('STUDENT')
  @HttpCode(200)
  @ApiOperation({ summary: 'Withdraw my application' })
  withdraw(@CurrentUser() u: AuthUser, @Param('id', id) listingId: string) {
    return this.applications.withdraw(u.id, listingId);
  }
}

@ApiTags('campus')
@ApiBearerAuth()
@Roles('STUDENT')
@Controller({ path: 'me/campus-applications', version: '1' })
export class MyCampusApplicationsController {
  constructor(private readonly applications: CampusApplicationsService) {}

  @Get()
  @ApiOperation({ summary: 'My own Campus applications, newest first' })
  mine(@CurrentUser() u: AuthUser, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.applications.mine(u.id, q.cursor, q.limit);
  }
}
