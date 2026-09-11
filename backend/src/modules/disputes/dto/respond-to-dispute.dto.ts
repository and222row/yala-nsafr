import { IsString, IsOptional, IsArray, MinLength } from 'class-validator';

export class RespondToDisputeDto {
  @IsString()
  @MinLength(10, { message: 'Please provide a detailed response (at least 10 characters)' })
  response: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidenceUrls?: string[];
}
