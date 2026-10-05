import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  addressInputSchema,
  addressUpdateSchema,
  addRoleSchema,
  CONSENT_PURPOSES,
  consentInputSchema,
  emergencyContactInputSchema,
  onboardingInputSchema,
  profileUpdateSchema,
  registerPushTokenSchema,
} from '@haggler/shared';
import { z } from 'zod';
import { ApiZodBody, ClientIp, CurrentUser, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ReputationService } from '../reputation/reputation.service';
import { AccountLifecycleService } from './account-lifecycle.service';
import { AddressesService } from './addresses.service';
import { EmergencyContactsService } from './emergency-contacts.service';
import { UsersService } from './users.service';

const uuidParam = new ZodPipe(z.string().uuid());

@ApiTags('users')
@ApiBearerAuth()
@Controller({ path: 'me', version: '1' })
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly lifecycle: AccountLifecycleService,
    private readonly addresses: AddressesService,
    private readonly contacts: EmergencyContactsService,
    private readonly reputation: ReputationService,
  ) {}

  @Get('league')
  @ApiOperation({
    summary: 'My client league, progress toward the next one, and the full ladder (Part E)',
  })
  league(@CurrentUser() user: AuthUser) {
    return this.reputation.getClientLeagueStatus(user.id);
  }

  @Get()
  @ApiOperation({ summary: 'My account, roles and any consents I still need to give' })
  me(@CurrentUser() user: AuthUser) {
    return this.users.getMe(user.id);
  }

  @Post('onboarding')
  @ApiOperation({
    summary:
      'The mandatory first-sign-in setup (name, date of birth, gender, email). One-time; ' +
      'refuses once already complete — use PATCH /me afterward.',
  })
  @ApiZodBody(onboardingInputSchema)
  onboarding(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(onboardingInputSchema)) body: z.infer<typeof onboardingInputSchema>,
  ) {
    return this.users.completeOnboarding(user.id, body);
  }

  @Patch()
  @ApiOperation({ summary: 'Update my profile (name, email, date of birth, gender, languages)' })
  @ApiZodBody(profileUpdateSchema)
  update(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(profileUpdateSchema)) body: z.infer<typeof profileUpdateSchema>,
  ) {
    return this.users.updateProfile(user.id, body);
  }

  @Patch('push-token')
  @ApiOperation({ summary: "Register this device's push notification token (Phase 5)" })
  @ApiZodBody(registerPushTokenSchema)
  registerPushToken(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(registerPushTokenSchema)) body: z.infer<typeof registerPushTokenSchema>,
  ) {
    return this.users.registerPushToken(user.id, body);
  }

  @Post('roles')
  @ApiOperation({
    summary: 'Add a role (Customer, Ranger or Employer). Student arrives with Haggler Campus.',
  })
  @ApiZodBody(addRoleSchema)
  addRole(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(addRoleSchema)) body: z.infer<typeof addRoleSchema>,
  ) {
    return this.users.addRole(user.id, body.role);
  }

  // ---- consent (DPDP) ------------------------------------------------------------------
  @Get('consents')
  @ApiOperation({ summary: 'My consent history' })
  consents(@CurrentUser() user: AuthUser) {
    return this.users.listConsents(user.id);
  }

  @Post('consents')
  @ApiOperation({ summary: 'Give consent for a purpose at the current legal version' })
  @ApiZodBody(consentInputSchema)
  grant(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(consentInputSchema)) body: z.infer<typeof consentInputSchema>,
    @ClientIp() ip?: string,
  ) {
    return this.users.grantConsent(user.id, body, ip);
  }

  @Delete('consents/:purpose')
  @ApiOperation({ summary: 'Withdraw consent for a purpose' })
  withdraw(
    @CurrentUser() user: AuthUser,
    @Param('purpose', new ParseEnumPipe(CONSENT_PURPOSES))
    purpose: (typeof CONSENT_PURPOSES)[number],
    @ClientIp() ip?: string,
  ) {
    return this.users.withdrawConsent(user.id, purpose, ip);
  }

  // ---- data rights ---------------------------------------------------------------------
  @Get('export')
  @ApiOperation({ summary: 'Download all data we hold about me (DPDP access right)' })
  export(@CurrentUser() user: AuthUser) {
    return this.lifecycle.exportData(user.id);
  }

  @Delete()
  @HttpCode(202)
  @ApiOperation({
    summary:
      'Request account deletion. Sessions end now; data is erased after a 30-day grace period.',
  })
  delete(@CurrentUser() user: AuthUser, @ClientIp() ip?: string) {
    return this.users.requestDeletion(user.id, ip);
  }

  // ---- addresses -----------------------------------------------------------------------
  @Get('addresses')
  @ApiOperation({ summary: 'My saved addresses' })
  listAddresses(@CurrentUser() user: AuthUser) {
    return this.addresses.list(user.id);
  }

  @Post('addresses')
  @ApiOperation({
    summary:
      'Save an address. Send latitude+longitude from the phone GPS, or we try to geocode it.',
  })
  @ApiZodBody(addressInputSchema)
  createAddress(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(addressInputSchema)) body: z.infer<typeof addressInputSchema>,
  ) {
    return this.addresses.create(user.id, body);
  }

  @Patch('addresses/:id')
  @ApiOperation({ summary: 'Edit one of my addresses' })
  @ApiZodBody(addressUpdateSchema)
  updateAddress(
    @CurrentUser() user: AuthUser,
    @Param('id', uuidParam) id: string,
    @Body(new ZodPipe(addressUpdateSchema)) body: z.infer<typeof addressUpdateSchema>,
  ) {
    return this.addresses.update(user.id, id, body);
  }

  @Delete('addresses/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete one of my addresses' })
  async deleteAddress(@CurrentUser() user: AuthUser, @Param('id', uuidParam) id: string) {
    await this.addresses.remove(user.id, id);
  }

  // ---- emergency contacts --------------------------------------------------------------
  @Get('emergency-contacts')
  @ApiOperation({ summary: 'My emergency contacts (used by SOS and live-trip sharing)' })
  listContacts(@CurrentUser() user: AuthUser) {
    return this.contacts.list(user.id);
  }

  @Post('emergency-contacts')
  @ApiOperation({ summary: 'Add an emergency contact (max 5)' })
  @ApiZodBody(emergencyContactInputSchema)
  createContact(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(emergencyContactInputSchema))
    body: z.infer<typeof emergencyContactInputSchema>,
  ) {
    return this.contacts.create(user.id, body);
  }

  @Patch('emergency-contacts/:id')
  @ApiOperation({ summary: 'Edit an emergency contact' })
  @ApiZodBody(emergencyContactInputSchema.partial())
  updateContact(
    @CurrentUser() user: AuthUser,
    @Param('id', uuidParam) id: string,
    @Body(new ZodPipe(emergencyContactInputSchema.partial().strict()))
    body: Partial<z.infer<typeof emergencyContactInputSchema>>,
  ) {
    return this.contacts.update(user.id, id, body);
  }

  @Delete('emergency-contacts/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove an emergency contact' })
  async deleteContact(@CurrentUser() user: AuthUser, @Param('id', uuidParam) id: string) {
    await this.contacts.remove(user.id, id);
  }
}
