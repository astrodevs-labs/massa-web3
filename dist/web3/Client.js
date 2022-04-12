"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Client = void 0;
const PrivateApiClient_1 = require("./PrivateApiClient");
const PublicApiClient_1 = require("./PublicApiClient");
const WalletClient_1 = require("./WalletClient");
const SmartContractsClient_1 = require("./SmartContractsClient");
/** Massa Web3 Client wrapping all public, private, wallet and smart-contracts-related functionalities */
class Client {
    constructor(clientConfig, baseAccount) {
        this.publicApiClient = new PublicApiClient_1.PublicApiClient(clientConfig);
        this.privateApiClient = new PrivateApiClient_1.PrivateApiClient(clientConfig);
        this.walletClient = new WalletClient_1.WalletClient(clientConfig, this.publicApiClient, baseAccount);
        this.smartContractsClient = new SmartContractsClient_1.SmartContractsClient(clientConfig, this.publicApiClient, this.walletClient);
        // exposed and bound class methods
        this.privateApi = this.privateApi.bind(this);
        this.publicApi = this.publicApi.bind(this);
        this.wallet = this.wallet.bind(this);
        this.smartContracts = this.smartContracts.bind(this);
    }
    /** Private Api related RPC methods */
    privateApi() {
        return this.privateApiClient;
    }
    /** Public Api related RPC methods */
    publicApi() {
        return this.publicApiClient;
    }
    /** Wallet related methods */
    wallet() {
        return this.walletClient;
    }
    /** Smart Contracts related methods */
    smartContracts() {
        return this.smartContractsClient;
    }
}
exports.Client = Client;
//# sourceMappingURL=Client.js.map