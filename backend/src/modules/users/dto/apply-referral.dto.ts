import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class ApplyReferralDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(4)
  @MaxLength(20)
  code: string;
}
