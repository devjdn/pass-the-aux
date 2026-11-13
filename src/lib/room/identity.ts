declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

/** Used to reference a member anywhere  */
export type MemberId = Brand<string, "MemberId">;

/** Secret to prove membership, not to be shown anywhere */
export type MemberToken = Brand<string, "MemberToken">;

export interface MemberCredentials {
  memberId: MemberId;
  token: MemberToken;
}
