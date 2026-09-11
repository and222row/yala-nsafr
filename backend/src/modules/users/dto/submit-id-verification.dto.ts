import { IsString, IsOptional, Length } from 'class-validator';

export class SubmitIdVerificationDto {
  @IsString()
  @Length(14, 14, { message: 'Egyptian national ID must be exactly 14 digits' })
  nationalIdNumber: string;

  @IsOptional()
  @IsString()
  nationalIdPhotoUrl?: string;
}
