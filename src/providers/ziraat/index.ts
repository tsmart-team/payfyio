import { Est } from '../est';

/**
 * Ziraat Bankası virtual POS — runs on EST (Asseco NestPay), so it is the
 * {@link Est} provider with Ziraat's host. Same config:
 * `clientId, username, password, storeKey`, optional `storeType`/`acceptedMdStatuses`.
 */
export class Ziraat extends Est {}
