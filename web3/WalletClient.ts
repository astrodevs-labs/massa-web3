import { IClientConfig } from "../interfaces/IClientConfig";
import { IAccount } from "../interfaces/IAccount";
import * as secp from "@noble/secp256k1";
import { BaseClient } from "./BaseClient";
import { IAddressInfo, IFullAddressInfo } from "../interfaces/IAddressInfo";
import { ISignature } from "../interfaces/ISignature";
import { base58checkDecode, base58checkEncode } from "../utils/Xbqcrypto";
import { BN }  from "bn.js";
import { JSON_RPC_REQUEST_METHOD } from "../interfaces/JsonRpcMethods";
import { trySafeExecute } from "../utils/retryExecuteFunction";
import { ITransactionData } from "../interfaces/ITransactionData";
import { JsonRpcResponseData } from "../interfaces/JsonRpcResponseData";
import { OperationTypeId } from "../interfaces/OperationTypes";

const MAX_WALLET_ACCOUNTS: number = 256;

/* web3/Wallet module that will under the hood interact with WebExtension, native client or interactively with user */
export class WalletClient extends BaseClient {

	private wallet: Array<IAccount> = [];
	private baseAccount: IAccount;

	public constructor(clientConfig: IClientConfig, baseAccount?: IAccount) {
		super(clientConfig);
		
		// ========== bind wallet methods ========= //

		// wallet methods
		this.getWalletAccounts = this.getWalletAccounts.bind(this);
		this.getWalletAccountByAddress = this.getWalletAccountByAddress.bind(this);
		this.addPrivateKeysToWallet = this.addPrivateKeysToWallet.bind(this);
		this.addAccountsToWallet = this.addAccountsToWallet.bind(this);
		this.removeAddressesFromWallet = this.removeAddressesFromWallet.bind(this);
		this.walletInfo = this.walletInfo.bind(this);
		this.signMessage = this.signMessage.bind(this);
		this.getWalletAddressesInfo = this.getWalletAddressesInfo.bind(this);
		this.setBaseAccount = this.setBaseAccount.bind(this);
		this.getBaseAccount = this.getBaseAccount.bind(this);
		this.sendTransaction = this.sendTransaction.bind(this);

		// init wallet with a base account if any
		if (baseAccount) {
			this.setBaseAccount(baseAccount);
			this.addAccountsToWallet([baseAccount]);
		}
	}

	public setBaseAccount(baseAccount: IAccount): void {
		this.baseAccount = baseAccount;
	}

	public getBaseAccount(): IAccount {
		return this.baseAccount;
	}

	// get all accounts under a wallet
	public getWalletAccounts(): Array<IAccount> {
		return this.wallet;
	}

	// get wallet account by an address
	public getWalletAccountByAddress(address: string): IAccount | undefined {
		return this.wallet.find((w) => w.address.toLowerCase() === address.toLowerCase()); // ignore case for flexibility
	}

	// add a list of private keys to the wallet
	public async addPrivateKeysToWallet(privateKeys: Array<string>): Promise<void> {
		if (privateKeys.length > MAX_WALLET_ACCOUNTS) {
			throw new Error(`Maximum number of allowed wallet accounts exceeded ${MAX_WALLET_ACCOUNTS}. Submitted private keys: ${privateKeys.length}`);
		}
		for (const privateKey of privateKeys) {
			const privateKeyBase58Decoded: Buffer = base58checkDecode(privateKey);
			const publickey: Uint8Array = secp.getPublicKey(privateKeyBase58Decoded, true); // key is compressed!
			const publicKeyBase58Encoded: string = base58checkEncode(publickey);

			const address: Uint8Array = await secp.utils.sha256(publickey);
			const addressBase58Encoded: string = base58checkEncode(address);

			if (!this.getWalletAccountByAddress(addressBase58Encoded)) {
				this.wallet.push({
					privateKey: privateKey, // submitted in base58
					publicKey: publicKeyBase58Encoded,
					address: addressBase58Encoded,
				} as IAccount);
			}
		}
	}

	// add accounts to wallet. Prerequisite: each account must have a full set of data (private, public keys and an address)
	public addAccountsToWallet(accounts: Array<IAccount>): void {
		if (accounts.length > MAX_WALLET_ACCOUNTS) {
			throw new Error(`Maximum number of allowed wallet accounts exceeded ${MAX_WALLET_ACCOUNTS}. Submitted accounts: ${accounts.length}`);
		}
		for (const account of accounts) {
			if (!account.privateKey) {
				throw new Error("Missing account private key");
			}
			if (!account.publicKey) {
				throw new Error("Missing account public key");
			}
			if (!account.address) {
				throw new Error("Missing account address");
			}
			if (!this.getWalletAccountByAddress(account.address)) {
				this.wallet.push(account);
			}
		}
	}

	// remove a list of addresses from the wallet
	public removeAddressesFromWallet(addresses: Array<string>): void {
		for (const address of addresses) {
			const index = this.wallet.findIndex((w) => w.address === address);
			if (index > -1) {
				this.wallet.splice(index, 1);
			}
		}
	}

	// show wallet info (private keys, public keys, addresses, balances ...)
	public async walletInfo(): Promise<Array<IFullAddressInfo>> {
		if (this.wallet.length === 0) {
			return [];
		}
		const addresses: Array<string> = this.wallet.map((account) => account.address);
		const addressesInfo: Array<IAddressInfo> = await this.getWalletAddressesInfo(addresses);

		if (addressesInfo.length !== this.wallet.length) {
			throw new Error(`Requested wallets not fully retrieved. Got ${addressesInfo.length}, expected: ${this.wallet.length}`);
		}

		return addressesInfo.map((info, index) => {
			return {
				publicKey: this.wallet[index].publicKey,
				privateKey: this.wallet[index].privateKey,
				...info
			} as IFullAddressInfo
		});
	} 

	 // generate a private key and add it into the wallet
	public static async walletGenerateNewAccount() {
		// generate private key
		const privateKey: Uint8Array = secp.utils.randomPrivateKey();
		const privateKeyBase58Encoded: string = base58checkEncode(privateKey);

		// get public key
		const publicKey: Uint8Array = secp.getPublicKey(privateKey, true);
		const publicKeyBase58Encoded: string = base58checkEncode(publicKey);

		// get wallet account address
		const address: Uint8Array = await secp.utils.sha256(publicKey);
		const addressBase58Encoded: string = base58checkEncode(address);

		return {
			address: addressBase58Encoded,
			privateKey: privateKeyBase58Encoded,
			publicKey: publicKeyBase58Encoded
		} as IAccount;
	}

	public async signMessage(data: string | Buffer, accountSignerAddress: string): Promise<ISignature> {
		const signerAccount = this.getWalletAccountByAddress(accountSignerAddress);
		if (!signerAccount) {
			throw new Error(`No signer account ${accountSignerAddress} found in wallet`);
		}
		return await WalletClient.walletSignMessage(data, signerAccount);
	}

	private async getWalletAddressesInfo(addresses: Array<string>) {
		const jsonRpcRequestMethod = JSON_RPC_REQUEST_METHOD.GET_ADDRESSES;
		if (this.clientConfig.retryStrategyOn) {
			return await trySafeExecute<Array<IAddressInfo>>(this.sendJsonRPCRequest,[jsonRpcRequestMethod, [addresses]]);
		} else {
			return await this.sendJsonRPCRequest<Array<IAddressInfo>>(jsonRpcRequestMethod, [addresses]);
		}
	}

	// sign provided string with given address (address must be in the wallet)
	public static async walletSignMessage(data: string | Buffer, signer: IAccount): Promise<ISignature> {

		// check private keys to sign the message with
		if (!signer.privateKey) {
			throw new Error("No private key to sign the message with");
		}

		// check public key to verify the message with
		if (!signer.publicKey) {
			throw new Error("No public key to verify the signed message with");
		}
		
    	// cast private key
		const privateKeyBase58Decoded = base58checkDecode(signer.privateKey);
		const base58PrivateKey = new BN(privateKeyBase58Decoded, 16);

		// bytes compaction
		const bytesCompact: Buffer = Buffer.from(data);
		// Hash byte compact
		const messageHashDigest: Uint8Array = await secp.utils.sha256(bytesCompact);

		// sign the digest
		const sig = await secp.sign(messageHashDigest, base58PrivateKey.toBuffer(), {
			der: false,
			recovered: true
		});

		// check sig length
		if (sig[0].length != 64) {
			throw new Error(`Invalid signature length. Expected 64, got ${sig[0].length}`);
		}

		// verify signature
		if (signer.publicKey) {
			const publicKeyBase58Decoded = base58checkDecode(signer.publicKey);
			const base58PublicKey = new BN(publicKeyBase58Decoded, 16);
			const isVerified = secp.verify(sig[0], messageHashDigest, base58PublicKey.toBuffer());
			if (!isVerified) {
				throw new Error(`Signature could not be verified with public key. Please inspect`);
			}
		}

		// extract sig vector
		const r: Uint8Array = sig[0].slice(0,32);
		const s: Uint8Array = sig[0].slice(32);
		const v: number = sig[1];
		const hex = secp.utils.bytesToHex(sig[0]);
		const base58Encoded = base58checkEncode(Buffer.concat([r, s]));
		
		return {
			r,
			s,
			v,
			hex,
			base58Encoded
		} as ISignature;
	}

	// send native MAS from a wallet address to another
	public async sendTransaction(txData: ITransactionData, executor: IAccount): Promise<Array<string>> {

		// bytes compaction
		const bytesCompact: Buffer = this.compactBytesForOperation(txData, OperationTypeId.Transaction, executor);

		// sign payload
		const signature = await WalletClient.walletSignMessage(bytesCompact, executor);

		//const signature = this.signOperation(txData, executor);
		const data = {
			content: {
				expire_period: txData.expirePeriod,
				fee: txData.fee.toString(),
				op: {
					Transaction: {
						amount: txData.amount.toString(),
						recipient_address: txData.recipientAddress
					}
				},
				sender_public_key: executor.publicKey
			},
			signature: signature.base58Encoded,
		}
		// returns operation ids
		const opIds: Array<string> = await this.sendJsonRPCRequest(JSON_RPC_REQUEST_METHOD.SEND_OPERATIONS, [[data]]);
		return opIds;
	}
}