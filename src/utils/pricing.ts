/* eslint-disable prefer-const */
import { ONE_BD, ZERO_BD, ZERO_BI } from './constants'
import { Bundle, Pool, Token } from '../types/schema'
import { BigDecimal, BigInt, log } from '@graphprotocol/graph-ts'
import { exponentToBigDecimal, safeDiv } from '../utils/index'

const WETH_ADDRESS = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1'
const USDC_WETH_03_POOL = '0x17c14d2c404d167802b16c450d3c99f88f2c4f4d'

// token where amounts should contribute to tracked volume and liquidity
// usually tokens that many tokens are paired with s
export let WHITELIST_TOKENS: string[] = [
  WETH_ADDRESS, // WETH
  '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8', // USDC
  '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', // USDT
  '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f', // WBTC
  '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1', // DAI
  '0xf97f4df75117a78c1a5a0dbb814af92458539fb4' // LINK
]

let MINIMUM_ETH_LOCKED = BigDecimal.fromString('0.01')

let Q192 = 2 ** 192
export function sqrtPriceX96ToTokenPrices(sqrtPriceX96: BigInt, token0: Token, token1: Token): BigDecimal[] {
  let num = sqrtPriceX96.times(sqrtPriceX96).toBigDecimal()
  let denom = BigDecimal.fromString(Q192.toString())
  let price1 = num
    .div(denom)
    .times(exponentToBigDecimal(token0.decimals))
    .div(exponentToBigDecimal(token1.decimals))

  let price0 = safeDiv(BigDecimal.fromString('1'), price1)
  return [price0, price1]
}

export function getEthPriceInUSD(): BigDecimal {
  // fetch eth prices for each stablecoin
  let usdcPool = Pool.load(USDC_WETH_03_POOL) // usdc is token1

  if (usdcPool !== null && usdcPool.liquidity.gt(ZERO_BI)) {
    // Check if we have a valid price
    if (usdcPool.token1Price.gt(ZERO_BD)) {
      return usdcPool.token1Price
    }
  }

  // Return a default ETH price if we can't calculate it yet
  // This is a reasonable estimate for Arbitrum ETH price
  return BigDecimal.fromString('2000')
}

/**
 * Search through graph to find derived Eth per token.
 * @todo update to be derived ETH (add stablecoin estimates)
 **/
export function findEthPerToken(token: Token): BigDecimal {
  if (token.id == WETH_ADDRESS) {
    return ONE_BD
  }
  let whiteList = token.whitelistPools
  // for now just take USD from pool with greatest TVL
  // need to update this to actually detect best rate based on liquidity distribution
  let largestLiquidityETH = ZERO_BD
  let priceSoFar = ZERO_BD

  // Bundle for ETH price
  let bundle = Bundle.load('1')
  if (!bundle) {
    log.warning('Bundle not found in findEthPerToken', [])
    return ZERO_BD
  }

  for (let i = 0; i < whiteList.length; ++i) {
    let poolAddress = whiteList[i]
    let pool = Pool.load(poolAddress)
    if (!pool) {
      log.warning('Pool not found in findEthPerToken: {}', [poolAddress])
      continue
    }
    if (pool.liquidity.gt(ZERO_BI)) {
      if (pool.token0 == token.id) {
        // whitelist token is token1
        let token1 = Token.load(pool.token1)
        if (!token1) {
          continue
        }
        // get the derived ETH in pool
        let ethLocked = pool.totalValueLockedToken1.times(token1.derivedETH)
        if (ethLocked.gt(largestLiquidityETH) && ethLocked.gt(MINIMUM_ETH_LOCKED)) {
          largestLiquidityETH = ethLocked
          // token1 per our token * Eth per token1
          priceSoFar = pool.token1Price.times(token1.derivedETH as BigDecimal)
        }
      }
      if (pool.token1 == token.id) {
        let token0 = Token.load(pool.token0)
        if (!token0) {
          continue
        }
        // get the derived ETH in pool
        let ethLocked = pool.totalValueLockedToken0.times(token0.derivedETH)
        if (ethLocked.gt(largestLiquidityETH) && ethLocked.gt(MINIMUM_ETH_LOCKED)) {
          largestLiquidityETH = ethLocked
          // token0 per our token * ETH per token0
          priceSoFar = pool.token0Price.times(token0.derivedETH as BigDecimal)
        }
      }
    }
  }
  return priceSoFar // nothing was found return 0
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD * 2.
 * If both are, return sum of two amounts
 * If neither is, return 0
 */
export function getTrackedAmountUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): BigDecimal {
  let bundle = Bundle.load('1')
  if (!bundle) {
    log.error('Bundle not found in getTrackedAmountUSD', [])
    return ZERO_BD
  }

  // Make sure we have a valid ETH price
  if (bundle.ethPriceUSD.equals(ZERO_BD)) {
    bundle.ethPriceUSD = getEthPriceInUSD()
    bundle.save()
  }

  let price0USD = token0.derivedETH.times(bundle.ethPriceUSD)
  let price1USD = token1.derivedETH.times(bundle.ethPriceUSD)

  // both are whitelist tokens, return sum of both amounts
  if (WHITELIST_TOKENS.includes(token0.id) && WHITELIST_TOKENS.includes(token1.id)) {
    return tokenAmount0.times(price0USD).plus(tokenAmount1.times(price1USD))
  }

  // take double value of the whitelisted token amount
  if (WHITELIST_TOKENS.includes(token0.id) && !WHITELIST_TOKENS.includes(token1.id)) {
    return tokenAmount0.times(price0USD).times(BigDecimal.fromString('2'))
  }

  // take double value of the whitelisted token amount
  if (!WHITELIST_TOKENS.includes(token0.id) && WHITELIST_TOKENS.includes(token1.id)) {
    return tokenAmount1.times(price1USD).times(BigDecimal.fromString('2'))
  }

  // neither token is on white list, tracked amount is 0
  return ZERO_BD
}