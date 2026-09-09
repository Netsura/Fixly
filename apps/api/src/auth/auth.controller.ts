import { Body, Controller, Get, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AuthTokenPayload } from './auth.types';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from './auth.constants';
import { createCsrfToken, CSRF_COOKIE } from '../common/csrf';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { env } from '@fixly/config';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly jwtService: JwtService,
  ) {}

  @Post('register')
  async register(@Body() input: RegisterDto, @Res({ passthrough: true }) response: Response) {
    const session = await this.authService.register(input);
    this.setCookies(response, session);
    return { user: session.user, csrfToken: session.csrfToken };
  }

  @Post('login')
  async login(@Body() input: LoginDto, @Res({ passthrough: true }) response: Response) {
    const session = await this.authService.login(input);
    this.setCookies(response, session);
    return { user: session.user, csrfToken: session.csrfToken };
  }

  @Post('refresh')
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const token = request.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined;
    if (!token) {
      throw new UnauthorizedException('Refresh token required');
    }

    const session = await this.authService.refresh(token);
    this.setCookies(response, session);
    return { user: session.user, csrfToken: session.csrfToken };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const token = request.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined;
    if (token) {
      await this.authService.logout(token);
    }
    response.clearCookie(ACCESS_TOKEN_COOKIE, { path: '/' });
    response.clearCookie(REFRESH_TOKEN_COOKIE, { path: '/api/auth' });
    response.clearCookie(CSRF_COOKIE, { path: '/' });
    return { success: true };
  }

  /**
   * Re-mints the CSRF token for the current session.
   *
   * Without this, a client whose CSRF cookie was cleared or expired could not
   * make any mutation - including logout or refresh - and would be stuck.
   * GET is safe, so the CSRF guard does not gate it.
   */
  @Get('csrf')
  @UseGuards(JwtAuthGuard)
  issueCsrfToken(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const token = request.cookies?.[ACCESS_TOKEN_COOKIE] as string | undefined;
    const sessionId = token ? this.jwtService.decode<AuthTokenPayload | null>(token)?.sessionId : undefined;
    if (!sessionId) {
      throw new UnauthorizedException('Authentication required');
    }

    const csrfToken = createCsrfToken(sessionId);
    response.cookie(CSRF_COOKIE, csrfToken, {
      httpOnly: false,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
      path: '/',
    });
    return { csrfToken };
  }

  @Post('verify-email')
  verifyEmail(@Body() input: VerifyEmailDto) {
    return this.authService.verifyEmail(input.token);
  }

  @Post('forgot-password')
  forgotPassword(@Body() input: ForgotPasswordDto) {
    return this.authService.requestPasswordReset(input.email);
  }

  @Post('reset-password')
  resetPassword(@Body() input: ResetPasswordDto) {
    return this.authService.resetPassword(input.token, input.password);
  }

  private setCookies(
    response: Response,
    session: { accessToken: string; refreshToken: string; csrfToken: string },
  ) {
    const secure = env.NODE_ENV === 'production';
    response.cookie(ACCESS_TOKEN_COOKIE, session.accessToken, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      maxAge: env.ACCESS_TOKEN_TTL_SECONDS * 1000,
      path: '/',
    });
    response.cookie(REFRESH_TOKEN_COOKIE, session.refreshToken, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
      path: '/api/auth',
    });
    // Readable by the browser on purpose: the client echoes it back in the
    // X-CSRF-Token header for the double-submit check.
    response.cookie(CSRF_COOKIE, session.csrfToken, {
      httpOnly: false,
      secure,
      sameSite: 'lax',
      maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
      path: '/',
    });
  }
}
