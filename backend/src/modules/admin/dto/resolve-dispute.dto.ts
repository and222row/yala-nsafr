import { IsEnum, IsOptional, IsString, IsNumber, IsUUID, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { DisputeStatus } from '../../../database/entities/dispute.entity';
import { UserStatus } from '../../../database/entities/user.entity';

export class ResolveDisputeDto {
  @IsEnum([
    DisputeStatus.RESOLVED_REFUND,
    DisputeStatus.RESOLVED_RELEASE,
    DisputeStatus.RESOLVED_SPLIT,
  ])
  resolution: DisputeStatus;

  @IsString()
  resolutionNotes: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  refundAmount?: number;

  /** Optional: UUID of user to block (suspend or ban) as part of the decision */
  @IsOptional()
  @IsUUID()
  blockUserId?: string;

  @IsOptional()
  @IsEnum([UserStatus.SUSPENDED, UserStatus.BANNED])
  blockStatus?: UserStatus.SUSPENDED | UserStatus.BANNED;
}
