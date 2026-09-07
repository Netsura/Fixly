import { Body, Controller, Get, Param, ParseBoolPipe, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@fixly/database';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { AdminService } from './admin.service';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('profile')
  profile(@CurrentUser() user: AuthenticatedUser) {
    return { id: user.id, email: user.email, role: user.role };
  }

  @Get('statistics')
  statistics() {
    return this.adminService.statistics();
  }

  @Get('users')
  users(@Query('page', new ParseIntPipe({ optional: true })) page = 1, @Query('limit', new ParseIntPipe({ optional: true })) limit = 25, @Query('search') search?: string) {
    return this.adminService.listUsers(page, limit, search);
  }

  @Patch('users/:id/suspension')
  suspend(@Param('id', ParseUUIDPipe) id: string, @Query('suspended', ParseBoolPipe) suspended: boolean) {
    return this.adminService.suspendUser(id, suspended);
  }

  @Post('services')
  createService(@Body() input: CreateServiceDto) {
    return this.adminService.createService(input);
  }

  @Patch('services/:id')
  updateService(@Param('id', ParseUUIDPipe) id: string, @Body() input: UpdateServiceDto) {
    return this.adminService.updateService(id, input);
  }
}
