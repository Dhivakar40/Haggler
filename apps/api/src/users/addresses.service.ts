import { Inject, Injectable } from '@nestjs/common';
import type { AddressDto, AddressInput, AddressUpdate } from '@haggler/shared';
import { MAX_ADDRESSES } from '@haggler/shared';
import { MAPS_PROVIDER, type MapsProvider } from '../adapters/maps/maps.provider';
import { conflict, notFound, unprocessable } from '../common/http-errors';
import { PrismaService } from '../prisma/prisma.service';

/** Rough India bounding box. Catches swapped lat/lng and (0,0). Mirrored by a DB CHECK constraint. */
export const INDIA_BOUNDS = { minLat: 6.0, maxLat: 37.5, minLng: 68.0, maxLng: 98.0 };

export function isInIndia(lat: number, lng: number): boolean {
  return (
    lat >= INDIA_BOUNDS.minLat &&
    lat <= INDIA_BOUNDS.maxLat &&
    lng >= INDIA_BOUNDS.minLng &&
    lng <= INDIA_BOUNDS.maxLng
  );
}

interface Row {
  id: string;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
  latitude: number | null;
  longitude: number | null;
}

@Injectable()
export class AddressesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MAPS_PROVIDER) private readonly maps: MapsProvider,
  ) {}

  /** Prisma cannot read PostGIS columns, so addresses are read with raw SQL (ST_Y = latitude, ST_X = longitude). */
  private async select(userId: string, id?: string): Promise<AddressDto[]> {
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT id::text AS id, label, line1, line2, city, state, pincode, is_default AS "isDefault",
             ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude
      FROM addresses
      WHERE user_id = ${userId}::uuid AND (${id ?? null}::uuid IS NULL OR id = ${id ?? null}::uuid)
      ORDER BY is_default DESC, created_at ASC`;
    return rows;
  }

  list(userId: string) {
    return this.select(userId);
  }

  async create(userId: string, input: AddressInput): Promise<AddressDto> {
    const count = await this.prisma.address.count({ where: { userId } });
    if (count >= MAX_ADDRESSES) throw conflict(`You can save up to ${MAX_ADDRESSES} addresses.`);

    const point = await this.resolvePoint(input);
    const { latitude: _la, longitude: _lo, isDefault, ...fields } = input;
    const makeDefault = isDefault === true || count === 0;

    const id = await this.prisma.$transaction(async (tx) => {
      if (makeDefault)
        await tx.address.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      const row = await tx.address.create({ data: { ...fields, userId, isDefault: makeDefault } });
      if (point) await this.setLocation(tx, row.id, point.latitude, point.longitude);
      return row.id;
    });
    return (await this.select(userId, id))[0] as AddressDto;
  }

  async update(userId: string, id: string, input: AddressUpdate): Promise<AddressDto> {
    await this.mustOwn(userId, id);
    const { latitude, longitude, isDefault, ...fields } = input;
    if (latitude !== undefined && longitude !== undefined && !isInIndia(latitude, longitude)) {
      throw unprocessable('Those coordinates are outside India.');
    }
    await this.prisma.$transaction(async (tx) => {
      if (isDefault === true)
        await tx.address.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      await tx.address.update({
        where: { id },
        data: { ...fields, ...(isDefault !== undefined ? { isDefault } : {}) },
      });
      if (latitude !== undefined && longitude !== undefined)
        await this.setLocation(tx, id, latitude, longitude);
    });
    return (await this.select(userId, id))[0] as AddressDto;
  }

  async remove(userId: string, id: string): Promise<void> {
    const addr = await this.mustOwn(userId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.address.delete({ where: { id } });
      if (addr.isDefault) {
        // Promote the oldest remaining address so the user always has a default.
        const next = await tx.address.findFirst({
          where: { userId },
          orderBy: { createdAt: 'asc' },
        });
        if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    });
  }

  /** Ownership check: someone else's address looks exactly like a missing one (404, no leak). */
  private async mustOwn(userId: string, id: string) {
    const addr = await this.prisma.address.findFirst({ where: { id, userId } });
    if (!addr) throw notFound('Address not found');
    return addr;
  }

  /** Prefer coordinates from the phone's GPS; otherwise ask the geocoder (sandbox: none). */
  private async resolvePoint(input: AddressInput) {
    if (input.latitude !== undefined && input.longitude !== undefined) {
      if (!isInIndia(input.latitude, input.longitude))
        throw unprocessable('Those coordinates are outside India.');
      return { latitude: input.latitude, longitude: input.longitude };
    }
    const query = [input.line1, input.line2, input.city, input.state, input.pincode, 'India']
      .filter(Boolean)
      .join(', ');
    const found = await this.maps.geocode(query);
    return found && isInIndia(found.latitude, found.longitude) ? found : null;
  }

  private setLocation(
    tx: Pick<PrismaService, '$executeRaw'>,
    id: string,
    latitude: number,
    longitude: number,
  ) {
    // ST_MakePoint takes (longitude, latitude), the reverse of how people say "lat, lng".
    return tx.$executeRaw`
      UPDATE addresses SET location = ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography
      WHERE id = ${id}::uuid`;
  }
}
