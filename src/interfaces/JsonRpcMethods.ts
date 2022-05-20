export enum JSON_RPC_REQUEST_METHOD {
	// public Api
	GET_STATUS = "get_status",
	GET_ADDRESSES = "get_addresses",
	SEND_OPERATIONS = "send_operations",
	GET_BLOCKS = "get_block",
	GET_ENDORSEMENTS = "get_endorsements",
	GET_OPERATIONS = "get_operations",
	GET_CLIQUES = "get_cliques",
	GET_STAKERS = "get_stakers",
	GET_FILTERED_SC_OUTPUT_EVENT = "get_filtered_sc_output_event",
	EXECUTE_READ_ONLY_BYTECODE = "execute_read_only_bytecode",
	EXECUTE_READ_ONLY_CALL = "execute_read_only_call",

	// private Api
	STOP_NODE = "stop_node",
	BAN = "ban",
	UNBAN = "unban",
	GET_STAKING_ADDRESSES = "get_staking_addresses",
	REMOVE_STAKING_ADDRESSES = "remove_staking_addresses",
	ADD_STAKING_PRIVATE_KEYS = "add_staking_private_keys",
	NODE_SIGN_MESSAGE = "node_sign_message",
}