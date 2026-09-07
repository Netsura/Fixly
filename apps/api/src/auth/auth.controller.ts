import { Body, Controller, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from './auth.constants';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { env } from '@fixly/config';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() input: RegisterDto, @Res({ passthrough: true }) response: Response) {
    const session = await this.authService.register(input);
    this.setCookies(response, session.accessToken, session.refreshToken);
    return { user: session.user };
  }

  @Post('login')
  async login(@Body() input: LoginDto, @Res({ passthrough: true }) response: Response) {
    const session = await this.authService.login(input);
    this.setCookies(response, session.accessToken, session.refreshToken);
    return { user: session.user };
  }

  @Post('refresh')
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const token = request.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined;
    if (!token) {
      throw new UnauthorizedException('Refresh token required');
    }

    const session = await this.authService.refresh(token);
    this.setCookies(response, session.accessToken, session.refreshToken);
    return { user: session.user };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const token = request.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined;
    if (token) {
      await this.authService.logout(token);
    }
    response.clearCookie(ACCESS_TOKEN_COOKIE);
    response.clearCookie(REFRESH_TOKEN_COOKIE);
    return { success: true };
  }

  private setCookies(response: Response, accessToken: string, refreshToken: string) {
    const secure = env.NODE_ENV === 'production';
    response.cookie(ACCESS_TOKEN_COOKIE, accessToken, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      maxAge: env.ACCESS_TOKEN_TTL_SECONDS * 1000,
      path: '/',
    });
    response.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
      path: '/api/auth',
    });
  }
}
