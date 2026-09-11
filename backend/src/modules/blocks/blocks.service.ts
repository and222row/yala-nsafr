import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Block } from '../../database/entities/block.entity';

@Injectable()
export class BlocksService {
  constructor(
    @InjectRepository(Block)
    private readonly blockRepo: Repository<Block>,
  ) {}

  async blockUser(blockerId: string, blockedId: string): Promise<void> {
    if (blockerId === blockedId) {
      throw new BadRequestException('You cannot block yourself');
    }
    const existing = await this.blockRepo.findOne({
      where: { blockerId, blockedId },
    });
    if (existing) {
      throw new BadRequestException('User is already blocked');
    }
    const block = this.blockRepo.create({ blockerId, blockedId });
    await this.blockRepo.save(block);
  }

  async unblockUser(blockerId: string, blockedId: string): Promise<void> {
    const block = await this.blockRepo.findOne({
      where: { blockerId, blockedId },
    });
    if (!block) {
      throw new NotFoundException('Block not found');
    }
    await this.blockRepo.remove(block);
  }

  /** Returns IDs of users that userId has blocked */
  async getBlockedIds(userId: string): Promise<string[]> {
    const blocks = await this.blockRepo.find({
      where: { blockerId: userId },
      select: { blockedId: true },
    });
    return blocks.map((b) => b.blockedId);
  }

  /** Returns IDs of users who have blocked userId */
  async getBlockerIds(userId: string): Promise<string[]> {
    const blocks = await this.blockRepo.find({
      where: { blockedId: userId },
      select: { blockerId: true },
    });
    return blocks.map((b) => b.blockerId);
  }

  async isBlocked(blockerId: string, blockedId: string): Promise<boolean> {
    const block = await this.blockRepo.findOne({
      where: { blockerId, blockedId },
    });
    return !!block;
  }
}
