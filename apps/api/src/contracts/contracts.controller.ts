import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  applyToContractSchema,
  contractDecisionSchema,
  createContractListingSchema,
  employerProfileUpdateSchema,
  updateContractListingSchema,
} from '@haggler/shared';
import { z } from 'zod';
import { ApiZodBody, CurrentUser, Roles, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ContractApplicationsService } from './contract-applications.service';
import { ContractListingsService } from './contract-listings.service';
import { EmployerProfileService } from './employer-profile.service';

const id = new ZodPipe(z.string().uuid());
const listQuery = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const browseQuery = listQuery.extend({
  categorySlug: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  payType: z.enum(['ONE_TIME', 'DAILY', 'WEEKLY', 'MONTHLY']).optional(),
});

@ApiTags('employer')
@ApiBearerAuth()
@Roles('EMPLOYER')
@Controller({ path: 'employer/profile', version: '1' })
export class EmployerProfileController {
  constructor(private readonly profiles: EmployerProfileService) {}

  @Get()
  @ApiOperation({ summary: 'My employer profile' })
  get(@CurrentUser() u: AuthUser) {
    return this.profiles.get(u.id);
  }

  @Patch()
  @ApiOperation({ summary: 'Set or update my business name' })
  @ApiZodBody(employerProfileUpdateSchema)
  update(
    @CurrentUser() u: AuthUser,
    @Body(new ZodPipe(employerProfileUpdateSchema))
    body: z.infer<typeof employerProfileUpdateSchema>,
  ) {
    return this.profiles.upsert(u.id, body);
  }
}

@ApiTags('employer')
@ApiBearerAuth()
@Roles('EMPLOYER')
@Controller({ path: 'employer/contracts', version: '1' })
export class EmployerContractsController {
  constructor(
    private readonly listings: ContractListingsService,
    private readonly applications: ContractApplicationsService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Post a Contract-labour listing' })
  @ApiZodBody(createContractListingSchema)
  create(
    @CurrentUser() u: AuthUser,
    @Body(new ZodPipe(createContractListingSchema))
    body: z.infer<typeof createContractListingSchema>,
  ) {
    return this.listings.create(u.id, body);
  }

  @Get()
  @ApiOperation({ summary: 'My listings, newest first' })
  mine(@CurrentUser() u: AuthUser, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.listings.mine(u.id, q.cursor, q.limit);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a listing, or change its status (pause/reopen/close/cancel)' })
  @ApiZodBody(updateContractListingSchema)
  update(
    @CurrentUser() u: AuthUser,
    @Param('id', id) listingId: string,
    @Body(new ZodPipe(updateContractListingSchema))
    body: z.infer<typeof updateContractListingSchema>,
  ) {
    return this.listings.update(u.id, listingId, body);
  }

  @Get(':id/applications')
  @ApiOperation({ summary: 'Every applicant for one of my listings' })
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
  @ApiOperation({ summary: 'Shortlist, reject or hire an applicant' })
  @ApiZodBody(contractDecisionSchema)
  decide(
    @CurrentUser() u: AuthUser,
    @Param('id', id) listingId: string,
    @Param('appId', id) applicationId: string,
    @Body(new ZodPipe(contractDecisionSchema)) body: z.infer<typeof contractDecisionSchema>,
  ) {
    return this.applications.decide(u.id, listingId, applicationId, body);
  }
}

@ApiTags('contracts')
@ApiBearerAuth()
@Controller({ path: 'contracts', version: '1' })
export class ContractsController {
  constructor(
    private readonly listings: ContractListingsService,
    private readonly applications: ContractApplicationsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Browse open Contract-labour listings' })
  browse(
    @CurrentUser() u: AuthUser,
    @Query(new ZodPipe(browseQuery)) q: z.infer<typeof browseQuery>,
  ) {
    return this.listings.browse(
      u.id,
      { categorySlug: q.categorySlug, city: q.city, payType: q.payType },
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
  @Roles('WORKER')
  @ApiOperation({ summary: 'Apply to a listing' })
  @ApiZodBody(applyToContractSchema)
  apply(
    @CurrentUser() u: AuthUser,
    @Param('id', id) listingId: string,
    @Body(new ZodPipe(applyToContractSchema)) body: z.infer<typeof applyToContractSchema>,
  ) {
    return this.applications.apply(u.id, listingId, body);
  }

  @Delete(':id/apply')
  @Roles('WORKER')
  @HttpCode(200)
  @ApiOperation({ summary: 'Withdraw my application' })
  withdraw(@CurrentUser() u: AuthUser, @Param('id', id) listingId: string) {
    return this.applications.withdraw(u.id, listingId);
  }
}

@ApiTags('contracts')
@ApiBearerAuth()
@Roles('WORKER')
@Controller({ path: 'me/contract-applications', version: '1' })
export class MyContractApplicationsController {
  constructor(private readonly applications: ContractApplicationsService) {}

  @Get()
  @ApiOperation({ summary: 'My own Contract-labour applications, newest first' })
  mine(@CurrentUser() u: AuthUser, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.applications.mine(u.id, q.cursor, q.limit);
  }
}
