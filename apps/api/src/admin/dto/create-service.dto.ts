import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateServiceDto {
  @IsUUID()
  categoryId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  slug!: string;
}
