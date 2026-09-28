import { Module } from '@nestjs/common';
import { MapsModule } from '../adapters/maps/maps.provider';
import { StorageModule } from '../adapters/storage/storage.service';
import { AccountLifecycleService } from './account-lifecycle.service';
import { AddressesService } from './addresses.service';
import { EmergencyContactsService } from './emergency-contacts.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [MapsModule, StorageModule],
  controllers: [UsersController],
  providers: [UsersService, AddressesService, EmergencyContactsService, AccountLifecycleService],
  exports: [UsersService, AccountLifecycleService],
})
export class UsersModule {}
