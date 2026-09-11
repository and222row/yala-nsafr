import { IsEnum, IsString, IsOptional, IsArray, IsUUID } from 'class-validator';
import { DisputeReason } from '../../../database/entities/dispute.entity';

export class OpenDisputeDto {
  @IsUUID()
  bookingId: string;

  @IsEnum(DisputeReason)
  reason: DisputeReason;

  @IsString()
  description: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidenceUrls?: string[];
}
