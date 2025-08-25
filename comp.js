const fs = require('fs');
const path = require('path');

console.log('🔧 Fixing AssemblyScript compilation errors...\n');

// Fix 1: Add explicit type casts in token.ts
console.log('Fixing src/utils/token.ts...');
const tokenPath = path.join('src', 'utils', 'token.ts');
let tokenContent = fs.readFileSync(tokenPath, 'utf8');
tokenContent = tokenContent.replace(
  /let byte = parseInt\(hexString\.substr\(i, 2\), 16\)/g,
  'let byte = i32(parseInt(hexString.substr(i, 2), 16))'
);
fs.writeFileSync(tokenPath, tokenContent);
console.log('✅ Fixed type casting in token.ts\n');

// Fix 2: Remove try-catch from pricing.ts
console.log('Fixing src/utils/pricing.ts...');
const pricingPath = path.join('src', 'utils', 'pricing.ts');
let pricingContent = fs.readFileSync(pricingPath, 'utf8');

// Replace the try-catch block
const tryPattern = /try\s*\{[\s\S]*?let prices = sqrtPriceX96ToTokenPrices[\s\S]*?\}\s*catch\s*\(e\)\s*\{[\s\S]*?\}/;
const replacement = `let prices = sqrtPriceX96ToTokenPrices(usdcPool.sqrtPrice, token0, token1)
      // USDC is token1, so we want token1Price which is ETH/USDC
      if (prices[1].gt(ZERO_BD) && prices[1].lt(BigDecimal.fromString('100000'))) { // Sanity check
        return prices[1]
      }`;

pricingContent = pricingContent.replace(tryPattern, replacement);
fs.writeFileSync(pricingPath, pricingContent);
console.log('✅ Removed try-catch from pricing.ts\n');

// Fix 3: Remove try-catch blocks from core.ts
console.log('Fixing src/mappings/core.ts...');
const corePath = path.join('src', 'mappings', 'core.ts');
let coreContent = fs.readFileSync(corePath, 'utf8');

// First try-catch block (price calculation)
const tryPattern1 = /try\s*\{[\s\S]*?let prices = sqrtPriceX96ToTokenPrices[\s\S]*?pool\.token1Price = prices\[1\][\s\S]*?\}\s*catch\s*\(e\)\s*\{[\s\S]*?pool\.token1Price = ZERO_BD[\s\S]*?\}/;
const replacement1 = `let prices = sqrtPriceX96ToTokenPrices(pool.sqrtPrice, token0 as Token, token1 as Token)
    pool.token0Price = prices[0]
    pool.token1Price = prices[1]`;

coreContent = coreContent.replace(tryPattern1, replacement1);

// Second try-catch block (pool data update)
const tryPattern2 = /\/\/ Safe update of pool data\s*try\s*\{[\s\S]*?updatePoolDayData\(event\)[\s\S]*?updatePoolHourData\(event\)[\s\S]*?\}\s*catch\s*\(e\)\s*\{[\s\S]*?\}/;
const replacement2 = `// Update pool data
  updatePoolDayData(event)
  updatePoolHourData(event)`;

coreContent = coreContent.replace(tryPattern2, replacement2);
fs.writeFileSync(corePath, coreContent);
console.log('✅ Removed try-catch blocks from core.ts\n');

console.log('✅ All fixes applied!');
console.log('Now run: npm run build');