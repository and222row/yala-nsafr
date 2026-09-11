import { IsArray, IsString, ArrayMinSize, ArrayMaxSize } from 'class-validator';

export class AddEvidenceDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  evidenceUrls: string[];
}
