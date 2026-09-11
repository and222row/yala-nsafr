import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class SettleWithdrawalDto {
  @IsEnum(['pay', 'reject'])
  action: 'pay' | 'reject';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  adminNote?: string;
}
