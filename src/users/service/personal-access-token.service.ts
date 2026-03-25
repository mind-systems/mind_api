import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import { PersonalAccessToken } from '../entities/personal-access-token.entity';
import { User } from '../entities/user.entity';
import { JwtPayload } from '../interfaces/auth.interface';

@Injectable()
export class PersonalAccessTokenService {
  constructor(
    @InjectRepository(PersonalAccessToken)
    private readonly patRepo: Repository<PersonalAccessToken>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async create(
    userId: string,
    name: string,
  ): Promise<{ token: string; id: string; name: string; createdAt: Date }> {
    const rawToken = `pat_${randomBytes(32).toString('hex')}`;
    const tokenHash = this.hash(rawToken);
    const entity = this.patRepo.create({ userId, tokenHash, name });
    const saved = await this.patRepo.save(entity);
    return {
      token: rawToken,
      id: saved.id,
      name: saved.name,
      createdAt: saved.createdAt,
    };
  }

  async list(userId: string): Promise<PersonalAccessToken[]> {
    return this.patRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      select: ['id', 'name', 'createdAt', 'lastUsedAt'],
    });
  }

  async revoke(id: string, userId: string): Promise<void> {
    const result = await this.patRepo.delete({ id, userId });
    if (!result.affected) {
      throw new NotFoundException('Token not found');
    }
  }

  async validateToken(rawToken: string): Promise<JwtPayload | null> {
    const tokenHash = this.hash(rawToken);
    const pat = await this.patRepo.findOne({ where: { tokenHash } });
    if (!pat) {
      return null;
    }

    const user = await this.userRepo.findOne({ where: { id: pat.userId } });
    if (!user) {
      return null;
    }

    await this.patRepo.update({ id: pat.id }, { lastUsedAt: new Date() });

    return { sub: user.id, email: user.email, name: user.name };
  }
}
