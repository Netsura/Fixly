import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { ConversationsService } from './conversations.service';

@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateConversationDto) {
    return this.conversationsService.create(user.id, input);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.conversationsService.list(user.id);
  }

  @Get(':id/messages')
  messages(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Query('cursor') cursor?: string) {
    return this.conversationsService.getMessages(user.id, id, cursor);
  }

  @Post(':id/messages')
  sendMessage(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: CreateMessageDto) {
    return this.conversationsService.sendMessage(user.id, id, input.body);
  }
}
