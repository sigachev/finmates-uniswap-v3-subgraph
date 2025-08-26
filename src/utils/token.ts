/* eslint-disable prefer-const */
import { ERC20 } from '../types/Factory/ERC20'
import { ERC20SymbolBytes } from '../types/Factory/ERC20SymbolBytes'
import { ERC20NameBytes } from '../types/Factory/ERC20NameBytes'
import { StaticTokenDefinition } from './staticTokenDefinition'
import { BigInt, Address, log } from '@graphprotocol/graph-ts'
import { isNullEthValue } from '.'

export function fetchTokenSymbol(tokenAddress: Address): string {
  if (tokenAddress.toHexString() == '0x0000000000000000000000000000000000000000') {
    return 'UNKNOWN'
  }

  let staticTokenDefinition = StaticTokenDefinition.fromAddress(tokenAddress)
  if (staticTokenDefinition != null) {
    return staticTokenDefinition.symbol
  }

  let contract = ERC20.bind(tokenAddress)
  let contractSymbolBytes = ERC20SymbolBytes.bind(tokenAddress)

  let symbolValue = 'unknown'
  let symbolResult = contract.try_symbol()
  if (!symbolResult.reverted && symbolResult.value.length > 0) {
    return symbolResult.value
  }

  let symbolResultBytes = contractSymbolBytes.try_symbol()
  if (!symbolResultBytes.reverted) {
    if (!isNullEthValue(symbolResultBytes.value.toHexString())) {
      let hexString = symbolResultBytes.value.toHexString()
      let result = ''
      let foundNull = false

      for (let i = 2; i < hexString.length && !foundNull; i += 2) {
        let byte = parseInt(hexString.substr(i, 2), 16) as i32
        if (byte === 0) {
          foundNull = true
        } else if (byte >= 32 && byte <= 126) {
          result += String.fromCharCode(byte)
        }
      }

      if (result.length > 0 && result.length < 32) {
        return result
      }
    }
  }

  return symbolValue
}

export function fetchTokenName(tokenAddress: Address): string {
  if (tokenAddress.toHexString() == '0x0000000000000000000000000000000000000000') {
    return 'Unknown Token'
  }

  let staticTokenDefinition = StaticTokenDefinition.fromAddress(tokenAddress)
  if (staticTokenDefinition != null) {
    return staticTokenDefinition.name
  }

  let contract = ERC20.bind(tokenAddress)
  let contractNameBytes = ERC20NameBytes.bind(tokenAddress)

  let nameValue = 'unknown'
  let nameResult = contract.try_name()
  if (!nameResult.reverted && nameResult.value.length > 0) {
    return nameResult.value
  }

  let nameResultBytes = contractNameBytes.try_name()
  if (!nameResultBytes.reverted) {
    if (!isNullEthValue(nameResultBytes.value.toHexString())) {
      let hexString = nameResultBytes.value.toHexString()
      let result = ''
      let foundNull = false

      for (let i = 2; i < hexString.length && !foundNull; i += 2) {
        let byte = parseInt(hexString.substr(i, 2), 16) as i32
        if (byte === 0) {
          foundNull = true
        } else if (byte >= 32 && byte <= 126) {
          result += String.fromCharCode(byte)
        }
      }

      if (result.length > 0 && result.length < 32) {
        return result
      }
    }
  }

  return nameValue
}

export function fetchTokenTotalSupply(tokenAddress: Address): BigInt {
  if (tokenAddress.toHexString() == '0x0000000000000000000000000000000000000000') {
    return BigInt.fromI32(0)
  }

  let contract = ERC20.bind(tokenAddress)
  let totalSupplyResult = contract.try_totalSupply()

  if (!totalSupplyResult.reverted) {
    return totalSupplyResult.value
  }

  return BigInt.fromI32(0)
}

export function fetchTokenDecimals(tokenAddress: Address): BigInt {
  if (tokenAddress.toHexString() == '0x0000000000000000000000000000000000000000') {
    return BigInt.fromI32(18)
  }

  let staticTokenDefinition = StaticTokenDefinition.fromAddress(tokenAddress)
  if (staticTokenDefinition != null) {
    return staticTokenDefinition.decimals
  }

  let contract = ERC20.bind(tokenAddress)
  let decimalResult = contract.try_decimals()

  if (!decimalResult.reverted) {
    let decimals = decimalResult.value
    if (decimals >= 0 && decimals <= 255) {
      return BigInt.fromI32(decimals)
    }
  }

  return BigInt.fromI32(18)
}