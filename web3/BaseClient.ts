import { EventEmitter } from "events";
import { IProvider, ProviderType } from "../interfaces/IProvider";
import { IClientConfig } from "../interfaces/IClientConfig";
import { Buffer } from "buffer";
import {base58checkDecode, base58checkEncode, hashSha256, typedArrayToBuffer, varintEncode} from "../utils/Xbqcrypto";
import { ecdsaSign, ecdsaVerify } from "secp256k1"
import { BN }  from "bn.js";
import { IAccount } from "../interfaces/IAccount";
import { IContractData } from "../interfaces/IContractData";
import { JsonRpcResponseData } from "../interfaces/JsonRpcResponseData";
import axios, { AxiosResponse, AxiosRequestHeaders } from "axios";
import { JSON_RPC_REQUEST_METHOD } from "../interfaces/JsonRpcMethods";
import { ITransactionData } from "../interfaces/ITransactionData";
import { OperationTypeId } from "../interfaces/OperationTypes";
import { IRollsData } from "../interfaces/IRollsData";

type DataType = IContractData | ITransactionData | IRollsData;

export class BaseClient extends EventEmitter {
	protected clientConfig: IClientConfig;
	protected baseAccount: IAccount;

	public constructor(clientConfig: IClientConfig, baseAccount?: IAccount) {
		super();
		this.clientConfig = clientConfig;
		if (this.getPrivateProviders().length === 0) {
			throw new Error("Cannot initialize web3 with no private providers. Need at least one");
		}
		if (this.getPublicProviders().length === 0) {
			throw new Error("Cannot initialize web3 with no public providers. Need at least one");
		}
		if (baseAccount) {
			this.setBaseAccount(baseAccount);
		}

		// bind class methods
		this.getPrivateProviders = this.getPrivateProviders.bind(this);
		this.getProviderForRpcMethod = this.getProviderForRpcMethod.bind(this);
		this.getPublicProviders = this.getPublicProviders.bind(this);
		this.setBaseAccount = this.setBaseAccount.bind(this);
		this.getBaseAccount = this.getBaseAccount.bind(this);
		this.sendJsonRPCRequest = this.sendJsonRPCRequest.bind(this);
		this.executeSC = this.executeSC.bind(this);
		this.sendTransaction = this.sendTransaction.bind(this);
		this.sellRolls = this.sellRolls.bind(this);
		this.buyRolls = this.buyRolls.bind(this);
		this.signOperation = this.signOperation.bind(this);
		this.computeBytesCompact = this.computeBytesCompact.bind(this);
	}

	public getPrivateProviders(): Array<IProvider> {
		return this.clientConfig.providers.filter((provider) => provider.type === ProviderType.PRIVATE);
	}

	public getPublicProviders(): Array<IProvider> {
		return this.clientConfig.providers.filter((provider) => provider.type === ProviderType.PUBLIC);
	}

	private getProviderForRpcMethod(jsonRpcRequestMethod: JSON_RPC_REQUEST_METHOD): IProvider {
		switch (jsonRpcRequestMethod) {
			case JSON_RPC_REQUEST_METHOD.GET_ADDRESSES:
			case JSON_RPC_REQUEST_METHOD.GET_STATUS:
			case JSON_RPC_REQUEST_METHOD.SEND_OPERATIONS:
			case JSON_RPC_REQUEST_METHOD.GET_OPERATIONS:
			case JSON_RPC_REQUEST_METHOD.GET_BLOCKS:
			case JSON_RPC_REQUEST_METHOD.GET_ENDORSEMENTS:
			case JSON_RPC_REQUEST_METHOD.GET_CLIQEUS:
			case JSON_RPC_REQUEST_METHOD.GET_STAKERS: {
					return this.getPublicProviders()[0]; //choose the first available public provider
				}
			case JSON_RPC_REQUEST_METHOD.STOP_NODE:
			case JSON_RPC_REQUEST_METHOD.BAN:
			case JSON_RPC_REQUEST_METHOD.UNBAN:
			case JSON_RPC_REQUEST_METHOD.GET_STAKING_ADDRESSES:
			case JSON_RPC_REQUEST_METHOD.REMOVE_STAKING_ADDRESSES:
			case JSON_RPC_REQUEST_METHOD.ADD_STAKING_PRIVATE_KEYS:
			case JSON_RPC_REQUEST_METHOD.NODE_SIGN_MESSAGE: {
				return this.getPrivateProviders()[0]; //choose the first available private provider
			}
			default: throw new Error("Unknown Json rpc method")
		}
	}

	public setBaseAccount(baseAccount: IAccount): void {
		this.baseAccount = baseAccount;
	}

	public getBaseAccount(): IAccount {
		return this.baseAccount;
	}

	// send a JSON rpc request to the node
	protected async sendJsonRPCRequest<T>(resource: JSON_RPC_REQUEST_METHOD, params: Object): Promise<T> {
		const promise = new Promise<JsonRpcResponseData<T>>(async (resolve, reject) => {
			let resp: AxiosResponse = null;

			const headers = {
				"Accept": "application/json",
				'Access-Control-Allow-Origin': '*'
			} as AxiosRequestHeaders;
		
			const body = {
				"jsonrpc": "2.0",
				"method": resource,
				"params": params,
				"id": 0
			};
		
			try {
				resp = await axios.post(this.getProviderForRpcMethod(resource).url, body, headers);
			} catch (ex) {
				return resolve({
					isError: true,
					result: null,
					error: new Error('JSON.parse error: ' + String(ex))
				} as JsonRpcResponseData<T>);
			}

			const responseData = resp.data;

			if (responseData.error) {
				return resolve({
					isError: true,
					result: null,
					error: new Error(responseData.error.message)
				} as JsonRpcResponseData<T>);
			}

			return resolve({
				isError: false,
				result: responseData.result as T,
				error: null
			} as JsonRpcResponseData<T>);
		});

		let resp: JsonRpcResponseData<T> = null;
		try {
			resp = await promise;
		} catch (ex) {
			throw ex;
		}

		// in case of rpc error, rethrow the error
		if (resp.error && resp.error) {
			throw resp.error;
		}

		return resp.result;
	}
	
	// create and send an operation containing byte code
	public async executeSC<T>(contractData: IContractData, executor?: IAccount): Promise<Array<string>> {
		const signature = this.signOperation(contractData, executor);
		const data = {
			content: {
				expire_period: contractData.expirePeriod,
				fee: contractData.fee.toString(),
				op: {
					ExecuteSC: {
						data: Array.from(atob(contractData.contractData), c => c.charCodeAt(0)),
						max_gas: contractData.maxGas,
						coins: contractData.coins.toString(),
						gas_price: contractData.gasPrice.toString()
					}
				},
				sender_public_key: executor.publicKey || this.baseAccount.publicKey
			},
			signature,
		}
		// returns operation ids
		const res: JsonRpcResponseData<Array<string>> = await this.sendJsonRPCRequest(JSON_RPC_REQUEST_METHOD.SEND_OPERATIONS, [[data]]);
		return res.result;
	}

	// send coins from a wallet address
	public async sendTransaction<T>(txData: ITransactionData, executor?: IAccount): Promise<Array<string>> {
		const signature = this.signOperation(txData, executor);
		const data = {
			content: {
				expire_period: txData.expirePeriod,
				fee: txData.fee.toString(),
				op: {
					Transaction: {
						amount: txData.amount,
						recipient_address: txData.recipient_address
					}
				},
				sender_public_key: executor.publicKey || this.baseAccount.publicKey
			},
			signature,
		}
		// returns operation ids
		const res: JsonRpcResponseData<Array<string>> = await this.sendJsonRPCRequest(JSON_RPC_REQUEST_METHOD.SEND_OPERATIONS, [[data]]);
		return res.result;
	}

	// buy rolls with wallet address
	public async buyRolls<T>(txData: ITransactionData, executor?: IAccount): Promise<Array<string>> {
		const signature = this.signOperation(txData, executor);
		const data = {
			content: {
				expire_period: txData.expirePeriod,
				fee: txData.fee.toString(),
				op: {
					RollBuy: {
						roll_count: txData.amount,
					}
				},
				sender_public_key: executor.publicKey || this.baseAccount.publicKey
			},
			signature,
		}
		// returns operation ids
		const res: JsonRpcResponseData<Array<string>> = await this.sendJsonRPCRequest(JSON_RPC_REQUEST_METHOD.SEND_OPERATIONS, [[data]]);
		return res.result;
	}

	// sell rolls with wallet address
	public async sellRolls<T>(txData: ITransactionData, executor?: IAccount): Promise<Array<string>> {
		const signature = this.signOperation(txData, executor);
		const data = {
			content: {
				expire_period: txData.expirePeriod,
				fee: txData.fee.toString(),
				op: {
					RollSell: {
						roll_count: txData.amount,
					}
				},
				sender_public_key: executor.publicKey || this.baseAccount.publicKey
			},
			signature,
		}
		// returns operation ids
		const res: JsonRpcResponseData<Array<string>> = await this.sendJsonRPCRequest(JSON_RPC_REQUEST_METHOD.SEND_OPERATIONS, [[data]]);
		return res.result;
	}

	public signOperation(data: DataType, signer?: IAccount) {
		// bytes compaction
		const bytesCompact: Buffer = this.computeBytesCompact(data, OperationTypeId.ExecuteSC, signer);
	
		// Hash byte compact
		const hashEncodedData: Buffer = hashSha256(bytesCompact);
	
		// Signing a digest
		const digest = new BN(hashEncodedData.valueOf());
		const privateKeyBase58Decoded = base58checkDecode(signer.privateKey || this.baseAccount.privateKey);
		const publicKeyBase58Decoded = base58checkDecode(signer.publicKey || this.baseAccount.publicKey);
		const base58PrivateKey = new BN(privateKeyBase58Decoded, 16);
		const base58PublicKey = new BN(publicKeyBase58Decoded, 16);

		const sig = ecdsaSign(digest.toBuffer(), base58PrivateKey.toBuffer());

		const isSigOk: boolean = ecdsaVerify(sig.signature, digest.toBuffer(), base58PublicKey.toBuffer());
		if (!isSigOk) {
			throw new Error("Malformed signature");
		}

		const r: Uint8Array = sig.signature.slice(0, 32);
		const s: Uint8Array = sig.signature.slice(32, 64);
		const rr: Uint8Array = Buffer.from(typedArrayToBuffer(r).toString(), "hex").valueOf();
		const ss: Uint8Array = Buffer.from(typedArrayToBuffer(s).toString(), "hex").valueOf();

		return base58checkEncode(Buffer.concat([rr, ss]));
	}
	
	private computeBytesCompact(data: DataType,  opTypeId: OperationTypeId, account?: IAccount): Buffer {
		const feeEncoded = Buffer.from(varintEncode(data.fee));
		const expirePeriodEncoded = Buffer.from(varintEncode(data.expirePeriod));
		const publicKeyEncoded = base58checkDecode(account.publicKey || this.baseAccount.publicKey);
		const typeIdEncoded = Buffer.from(varintEncode(opTypeId.valueOf()));

		switch (opTypeId) {
			case OperationTypeId.ExecuteSC: {

				const maxGasEncoded = Buffer.from(varintEncode((data as IContractData).maxGas));
				const coinsEncoded = Buffer.from(varintEncode((data as IContractData).coins));
				const gasPriceEncoded = Buffer.from(varintEncode((data as IContractData).gasPrice));
				const dataLengthEncoded = Buffer.from(varintEncode((data as IContractData).contractData.length));
				const contractDataEncoded = Uint8Array.from(atob((data as IContractData).contractData), c => c.charCodeAt(0));
		
				return Buffer.concat([feeEncoded, expirePeriodEncoded, publicKeyEncoded, typeIdEncoded, maxGasEncoded, coinsEncoded, gasPriceEncoded, dataLengthEncoded, contractDataEncoded]);
			}
			case OperationTypeId.Transaction: {
				const recepientAddressEncoded = Buffer.from(varintEncode((data as ITransactionData).recipient_address));
				const transferAmountEncoded = Buffer.from(varintEncode((data as ITransactionData).amount));
		
				return Buffer.concat([feeEncoded, expirePeriodEncoded, publicKeyEncoded, typeIdEncoded, recepientAddressEncoded, transferAmountEncoded]);
			}
			case OperationTypeId.RollBuy:
			case OperationTypeId.RollSell: {
				const rollAmountEncoded = Buffer.from(varintEncode((data as IRollsData).amount));
		
				return Buffer.concat([feeEncoded, expirePeriodEncoded, publicKeyEncoded, typeIdEncoded, rollAmountEncoded]);
			}
		}
	}

	//OTHER OPERATIONS (TODO)
	public readonlySmartContract = (bytecode, maxGas, gasPrice, address) => { /* TODO */ } // execute byte code, address is optionnal. Nothing is really executed on chain
	public getFilteredScOutputEvents = (startSlot, endSlot, emitterAddress, originalCallerAddress, operationId)  => { /* TODO */ }
}