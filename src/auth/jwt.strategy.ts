import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminRole } from '@prisma/client';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface JwtPayload {
  sub: string;
  email: string;
  role: AdminRole;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET'),
    });
  }

  validate(payload: JwtPayload) {
    // Tokens issued before roles existed belonged to full admins.
    return { sub: payload.sub, email: payload.email, role: payload.role ?? AdminRole.ADMIN };
  }
}
