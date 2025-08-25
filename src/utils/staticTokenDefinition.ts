/* eslint-disable prefer-const */
import { Address, BigInt } from '@graphprotocol/graph-ts'

// Initialize a Token Definition with the attributes
export class StaticTokenDefinition {
  address: Address
  symbol: string
  name: string
  decimals: BigInt

  // Initialize a Token Definition with its attributes
  constructor(address: Address, symbol: string, name: string, decimals: BigInt) {
    this.address = address
    this.symbol = symbol
    this.name = name
    this.decimals = decimals
  }

  // Get all tokens with a static defintion
  static getStaticDefinitions(): Array<StaticTokenDefinition> {
    // Create array without fixed size
    let staticDefinitions = new Array<StaticTokenDefinition>()

    // Add WETH - Arbitrum
    let tokenWETH = new StaticTokenDefinition(
      Address.fromString('0x82af49447d8a07e3bd95bd0d56f35241523fbab1'),
      'WETH',
      'Wrapped Ethereum',
      BigInt.fromI32(18)
    )
    staticDefinitions.push(tokenWETH)

    // USDC - Arbitrum
    let tokenUSDC = new StaticTokenDefinition(
      Address.fromString('0xff970a61a04b1ca14834a43f5de4533ebddb5cc8'),
      'USDC',
      'USD Coin',
      BigInt.fromI32(6)
    )
    staticDefinitions.push(tokenUSDC)

    // USDT - Arbitrum
    let tokenUSDT = new StaticTokenDefinition(
      Address.fromString('0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9'),
      'USDT',
      'Tether USD',
      BigInt.fromI32(6)
    )
    staticDefinitions.push(tokenUSDT)

    // WBTC - Arbitrum
    let tokenWBTC = new StaticTokenDefinition(
      Address.fromString('0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f'),
      'WBTC',
      'Wrapped Bitcoin',
      BigInt.fromI32(8)
    )
    staticDefinitions.push(tokenWBTC)

    // DAI - Arbitrum
    let tokenDAI = new StaticTokenDefinition(
      Address.fromString('0xda10009cbd5d07dd0cecc66161fc93d7c9000da1'),
      'DAI',
      'DAI Stablecoin',
      BigInt.fromI32(18)
    )
    staticDefinitions.push(tokenDAI)

    // LINK - Arbitrum
    let tokenLINK = new StaticTokenDefinition(
      Address.fromString('0xf97f4df75117a78c1a5a0dbb814af92458539fb4'),
      'LINK',
      'Chainlink',
      BigInt.fromI32(18)
    )
    staticDefinitions.push(tokenLINK)

    // ARB - Arbitrum native token
    let tokenARB = new StaticTokenDefinition(
      Address.fromString('0x912ce59144191c1204e64559fe8253a0e49e6548'),
      'ARB',
      'Arbitrum',
      BigInt.fromI32(18)
    )
    staticDefinitions.push(tokenARB)

    // USDC.e - Bridged USDC
    let tokenUSDCe = new StaticTokenDefinition(
      Address.fromString('0xff970a61a04b1ca14834a43f5de4533ebddb5cc8'),
      'USDC.e',
      'Bridged USDC',
      BigInt.fromI32(6)
    )
    staticDefinitions.push(tokenUSDCe)

    // GMX - Arbitrum
    let tokenGMX = new StaticTokenDefinition(
      Address.fromString('0xfc5a1a6eb076a2c7ad06ed22c90d7e710e35ad0a'),
      'GMX',
      'GMX',
      BigInt.fromI32(18)
    )
    staticDefinitions.push(tokenGMX)

    // RDNT - Arbitrum
    let tokenRDNT = new StaticTokenDefinition(
      Address.fromString('0x3082cc23568ea640225c2467653db90e9250aaa0'),
      'RDNT',
      'Radiant',
      BigInt.fromI32(18)
    )
    staticDefinitions.push(tokenRDNT)

    return staticDefinitions
  }

  // Helper for hardcoded tokens
  static fromAddress(tokenAddress: Address): StaticTokenDefinition | null {
    let staticDefinitions = this.getStaticDefinitions()
    let tokenAddressHex = tokenAddress.toHexString()

    // Search the definition using the address
    for (let i = 0; i < staticDefinitions.length; i++) {
      let staticDefinition = staticDefinitions[i]
      if (staticDefinition.address.toHexString() == tokenAddressHex) {
        return staticDefinition
      }
    }

    // If not found, return null
    return null
  }
}