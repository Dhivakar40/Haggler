import { Module } from '@nestjs/common';
import { ContractApplicationsService } from './contract-applications.service';
import { ContractListingsService } from './contract-listings.service';
import {
  ContractsController,
  EmployerContractsController,
  EmployerProfileController,
  MyContractApplicationsController,
} from './contracts.controller';
import { EmployerProfileService } from './employer-profile.service';

/** Contract labour (Phase 6): a job board, not on-demand dispatch. See docs/DECISIONS.md D-054. */
@Module({
  controllers: [
    EmployerProfileController,
    EmployerContractsController,
    ContractsController,
    MyContractApplicationsController,
  ],
  providers: [EmployerProfileService, ContractListingsService, ContractApplicationsService],
})
export class ContractsModule {}
