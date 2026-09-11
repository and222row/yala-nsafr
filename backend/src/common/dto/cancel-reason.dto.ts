import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CancelReasonDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
