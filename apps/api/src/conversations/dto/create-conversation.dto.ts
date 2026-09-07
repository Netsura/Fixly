import { IsOptional, IsUUID } from 'class-validator';

export class CreateConversationDto {
  @IsOptional()
  @IsUUID()
  bookingId?: string;

  @IsOptional()
  @IsUUID()
  participantUserId?: string;
}
