import { IsEnum, IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PayoutMethod } from '../../../database/entities/withdrawal-request.entity';

export class RequestWithdrawalDto {
  @IsNumber()
  @Min(200)
  @Type(() => Number)
  amount: number;

  @IsEnum(PayoutMethod)
  payoutMethod: PayoutMethod;

  @IsString()
  @Length(11, 30)
  payoutAccount: string;

  @IsString()
  @Length(2, 100)
  payoutName: string;

  @IsOptional()
  @IsString()
  payoutBank?: string;
}
