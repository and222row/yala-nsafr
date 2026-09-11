import { IsEnum, IsString, MinLength, MaxLength } from 'class-validator';

export class NotifyPartyDto {
  @IsEnum(['opener', 'other_party', 'both'])
  target: 'opener' | 'other_party' | 'both';

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  message: string;
}
