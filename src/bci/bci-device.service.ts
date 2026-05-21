import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { BciDevice } from './entities/bci-device.entity';

@Injectable()
export class BciDeviceService {
  constructor(
    @InjectRepository(BciDevice)
    private readonly bciDevicesRepo: Repository<BciDevice>,
  ) {}

  async listForUser(userId: string): Promise<BciDevice[]> {
    return this.bciDevicesRepo.find({
      where: { userId },
      order: { updatedAt: 'DESC' },
    });
  }

  async register(userId: string, serial: string): Promise<BciDevice> {
    // Fast path: row already exists — force-bump updated_at so List ordering reflects re-pair.
    // .save(existingRow) unchanged would NOT move @UpdateDateColumn; explicit update is required.
    const updateResult = await this.bciDevicesRepo.update(
      { userId, serial },
      { updatedAt: () => 'CURRENT_TIMESTAMP' },
    );
    if ((updateResult.affected ?? 0) > 0) {
      return this.bciDevicesRepo.findOneByOrFail({ userId, serial });
    }

    // Insert path. Catch unique-violation race (concurrent insert between the UPDATE above
    // and this INSERT) and re-fetch — Postgres SQLSTATE 23505.
    try {
      const created = this.bciDevicesRepo.create({ userId, serial });
      return await this.bciDevicesRepo.save(created);
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        (err as QueryFailedError & { code?: string }).code === '23505'
      ) {
        // Concurrent register won the race — re-fetch the row.
        // Do NOT bump updated_at here: the other writer already set it.
        return this.bciDevicesRepo.findOneByOrFail({ userId, serial });
      }
      throw err;
    }
  }

  async delete(userId: string, id: string): Promise<void> {
    const row = await this.bciDevicesRepo.findOneBy({ id });
    if (!row) {
      throw new RpcException({
        code: GrpcStatus.NOT_FOUND,
        message: 'BCI device not found',
      });
    }
    if (row.userId !== userId) {
      throw new RpcException({
        code: GrpcStatus.PERMISSION_DENIED,
        message: 'BCI device belongs to another user',
      });
    }
    await this.bciDevicesRepo.delete({ id });
  }
}
