export async function handle(state, action) {
  const input = action.input;

  if (input.function === "executeLock") {
    // sig is not needed here as its already validated on EVM side
    // so without a sig,the dapp can invoke `executeLock`on behalf of user
    const { txid, caller } = input;
    const normalizedCaller = _normalizeCaller(caller);
    const req = (
      await EXM.deterministicFetch(
        `${state.mem_molecule}/${txid}/${normalizedCaller}/${state.bridge_address}`,
      )
    )?.asJSON();
    ContractAssert(req.caller.toLowerCase() == normalizedCaller, "err");
    ContractAssert(req.amount > 0, "err");
    ContractAssert(
      !state.locks.includes(txid.toLowerCase()),
      "err_lock_already_redeemed",
    );
    state.locks.push(txid.toLowerCase());

    if (!(normalizedCaller in state.balances)) {
      state.balances[normalizedCaller] = 0;
    }

    state.balances[normalizedCaller] += req.amount;

    return { state };
  }

  if (input.function === "initiateUnlock") {
    const { caller, sig, amount } = input;

    const normalizedCaller = _normalizeCaller(caller);
    ContractAssert(Number.isInteger(amount), "err_amount_not_integer");
    ContractAssert(amount <= state.balances[normalizedCaller], "err");

    await _moleculeSignatureVerification(normalizedCaller, sig);

    state.unlocks.push({
      address: normalizedCaller,
      mid: sig,
      amount: amount,
    });

    state.balances[normalizedCaller] -= amount;

    return { state };
  }

  if (input.function === "transfer") {
    const { caller, sig, target, amount } = input;

    const normalizedCaller = _normalizeCaller(caller);
    const normalizedTarget = _normalizeCaller(target);

    ContractAssert(Number.isInteger(amount), "err_amount_not_integer");
    ContractAssert(amount <= state.balances[normalizedCaller], "err");
    ContractAssert(normalizedCaller !== normalizedTarget, "err_self_transfer");

    await _moleculeSignatureVerification(normalizedCaller, sig);

    if (!(normalizedTarget in state.balances)) {
      state.balances[normalizedTarget] = 0;
    }

    state.balances[normalizedTarget] += amount;
    state.balances[normalizedCaller] -= amount;

    return { state };
  }

  async function _moleculeSignatureVerification(caller, signature) {
    try {
      ContractAssert(
        !state.signatures.includes(signature),
        "ERROR_SIGNATURE_ALREADY_USED",
      );

      const encodedMessage = btoa(`${state.sig_message}${state.counter}`);

      const isValid = await EXM.deterministicFetch(
        `${state.evm_molecule_endpoint}/signer/${caller}/${encodedMessage}/${signature}`,
      );
      ContractAssert(isValid.asJSON()?.result, "ERROR_UNAUTHORIZED_CALLER");
      state.signatures.push(signature);
      state.counter += 1;
    } catch (error) {
      throw new ContractError("ERROR_MOLECULE.SH_CONNECTION");
    }
  }

  function _validateEoaSyntax(address) {
    ContractAssert(
      /^(0x)?[0-9a-fA-F]{40}$/.test(address),
      "ERROR_INVALID_EOA_ADDR",
    );
  }

  function _normalizeCaller(address) {
    _validateEoaSyntax(address);
    return address.toLowerCase();
  }
}
