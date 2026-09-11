import { IsNumber, IsOptional, Min, Max, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateConfigDto {
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @Max(0.5)
  commissionRate?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @IsPositive()
  autoConfirmHours?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @IsPositive()
  disputeWindowHours?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @IsPositive()
  ratingRevealDays?: number;
}
