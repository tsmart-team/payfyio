import { Est } from '../est';

/**
 * İş Bankası virtual POS — runs on EST (Asseco NestPay), so it is the
 * {@link Est} provider with İş Bankası's host. Same config:
 * `clientId, username, password, storeKey`, optional `storeType`/`acceptedMdStatuses`.
 */
export class Isbank extends Est {}
