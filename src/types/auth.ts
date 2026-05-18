export type JWTPayload = {
  sub: string; // user id
  sid: string; // session id
  iat: number;
  exp: number;
};
