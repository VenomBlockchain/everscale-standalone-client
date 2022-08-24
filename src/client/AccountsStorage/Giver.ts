import type * as nt from 'nekoton-wasm';
import { Address } from 'everscale-inpage-provider';

import { Account, PrepareMessageParams, PrepareMessageContext, FetchPublicKeyContext } from './';

/**
 * Any account which supports Giver ABI (GiverV2, SafeMultisig, SetcodeMultisig, Surf):
 *
 * ```
 * {
 *   "ABI version": 2,
 *   "header": ["pubkey", "time", "expire"],
 *   "functions": [{
 *     "name": "sendTransaction",
 *     "inputs": [
 *       {"name":"dest","type":"address"},
 *       {"name":"value","type":"uint128"},
 *       {"name":"bounce","type":"bool"},
 *       {"name":"flags","type":"uint8"},
 *       {"name":"payload","type":"cell"}
 *     ],
 *     "outputs": []
 *   }],
 *   "events": []
 * }
 * ```
 *
 * @category AccountsStorage
 */
export class GiverAccount implements Account {
  public readonly address: Address;
  private publicKey?: string;

  constructor(args: { address: string | Address, publicKey?: string }) {
    this.address = args.address instanceof Address ? args.address : new Address(args.address);
    this.publicKey = args.publicKey;
  }

  public async fetchPublicKey(ctx: FetchPublicKeyContext): Promise<string> {
    if (this.publicKey != null) {
      return this.publicKey;
    }

    this.publicKey = await ctx.connectionController.use(async ({ data: { transport } }) => {
      const state = await transport.getFullContractState(this.address.toString());
      if (state == null || !state.isDeployed) {
        throw new Error('Contract not deployed');
      }
      return ctx.nekoton.extractPublicKey(state.boc);
    });
    return this.publicKey;
  }

  async prepareMessage(args: PrepareMessageParams, ctx: PrepareMessageContext): Promise<nt.SignedMessage> {
    const publicKey = await this.fetchPublicKey(ctx);
    const signer = await ctx.keystore.getSigner(publicKey);
    if (signer == null) {
      throw new Error('Signer not found');
    }

    const payload = args.payload
      ? ctx.nekoton.encodeInternalInput(args.payload.abi, args.payload.method, args.payload.params)
      : '';

    const unsignedMessage = ctx.nekoton.createExternalMessage(
      ctx.clock,
      this.address.toString(),
      GIVER_ABI,
      'sendTransaction',
      undefined,
      {
        dest: args.recipient,
        value: args.amount,
        bounce: args.bounce,
        flags: 3,
        payload,
      },
      publicKey,
      args.timeout,
    );

    try {
      const signature = await signer.sign(unsignedMessage.hash);
      return unsignedMessage.sign(signature);
    } finally {
      unsignedMessage.free();
    }
  }
}

const GIVER_ABI = `{
  "ABI version": 2,
  "header": ["pubkey", "time", "expire"],
  "functions": [{
    "name": "sendTransaction",
    "inputs": [
      {"name":"dest","type":"address"},
      {"name":"value","type":"uint128"},
      {"name":"bounce","type":"bool"},
      {"name":"flags","type":"uint8"},
      {"name":"payload","type":"cell"}
    ],
    "outputs": []
  }],
  "events": []
}`;
