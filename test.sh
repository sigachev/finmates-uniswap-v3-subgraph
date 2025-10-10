#!/bin/bash

echo "========================================"
echo "RPC Connection Diagnostic Script"
echo "========================================"
echo ""

RPC_URL="https://arbitrum-rpc.finmates.com"

echo "Testing RPC: $RPC_URL"
echo ""

# Test 1: Basic connectivity
echo "1. Testing basic HTTPS connectivity..."
if curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$RPC_URL" > /dev/null 2>&1; then
    echo "   ✓ Can reach $RPC_URL"
else
    echo "   ✗ Cannot reach $RPC_URL"
    echo "   This might be a firewall or DNS issue"
fi
echo ""

# Test 2: DNS resolution
echo "2. Testing DNS resolution..."
if nslookup arbitrum-rpc.finmates.com > /dev/null 2>&1; then
    echo "   ✓ DNS resolves correctly"
    nslookup arbitrum-rpc.finmates.com | grep "Address:" | tail -n 1
else
    echo "   ✗ DNS resolution failed"
fi
echo ""

# Test 3: eth_blockNumber
echo "3. Testing eth_blockNumber RPC call..."
RESPONSE=$(curl -s -X POST "$RPC_URL" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  --max-time 10)

if echo "$RESPONSE" | grep -q "result"; then
    BLOCK=$(echo "$RESPONSE" | grep -o '"result":"[^"]*"' | cut -d'"' -f4)
    BLOCK_DEC=$((16#${BLOCK:2}))
    echo "   ✓ RPC responding correctly"
    echo "   Current block: $BLOCK_DEC (hex: $BLOCK)"
else
    echo "   ✗ RPC not responding or error"
    echo "   Response: $RESPONSE"
fi
echo ""

# Test 4: eth_chainId
echo "4. Testing eth_chainId RPC call..."
RESPONSE=$(curl -s -X POST "$RPC_URL" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
  --max-time 10)

if echo "$RESPONSE" | grep -q "result"; then
    CHAIN_ID=$(echo "$RESPONSE" | grep -o '"result":"[^"]*"' | cut -d'"' -f4)
    CHAIN_DEC=$((16#${CHAIN_ID:2}))
    echo "   ✓ Chain ID call successful"
    echo "   Chain ID: $CHAIN_DEC (hex: $CHAIN_ID)"
    if [ "$CHAIN_DEC" -eq 42161 ]; then
        echo "   ✓ Confirmed Arbitrum One (chain ID: 42161)"
    else
        echo "   ⚠ Warning: Expected Arbitrum One (42161), got $CHAIN_DEC"
    fi
else
    echo "   ✗ Chain ID call failed"
    echo "   Response: $RESPONSE"
fi
echo ""

# Test 5: From inside Docker
echo "5. Testing from inside Docker container..."
echo "   Starting temporary container..."
DOCKER_TEST=$(docker run --rm curlimages/curl:latest curl -s -X POST "$RPC_URL" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  --max-time 10 2>&1)

if echo "$DOCKER_TEST" | grep -q "result"; then
    echo "   ✓ RPC accessible from Docker container"
else
    echo "   ✗ RPC NOT accessible from Docker container"
    echo "   This is likely your issue!"
    echo "   Error: $DOCKER_TEST"
fi
echo ""

# Test 6: SSL Certificate
echo "6. Testing SSL certificate..."
SSL_INFO=$(curl -vI "$RPC_URL" 2>&1 | grep -E "SSL certificate|server certificate")
if [ -n "$SSL_INFO" ]; then
    echo "   SSL info: $SSL_INFO"
else
    echo "   Could not verify SSL certificate info"
fi
echo ""

echo "========================================"
echo "Summary & Recommendations"
echo "========================================"
echo ""

# Provide recommendations based on tests
if echo "$DOCKER_TEST" | grep -q "result"; then
    echo "✓ Your RPC is working correctly with Docker!"
    echo "  The Graph Node connection issue might be configuration-related."
    echo ""
    echo "Next steps:"
    echo "  1. Check docker-compose.yml has correct RPC URL"
    echo "  2. Restart Graph Node: docker-compose restart graph-node"
    echo "  3. Check logs: docker-compose logs -f graph-node"
else
    echo "✗ Your RPC cannot be reached from Docker containers"
    echo ""
    echo "Possible solutions:"
    echo "  1. If RPC is on your host machine:"
    echo "     Use: http://host.docker.internal:PORT"
    echo ""
    echo "  2. If RPC has firewall:"
    echo "     Whitelist Docker network: 172.17.0.0/16"
    echo ""
    echo "  3. If using self-signed SSL certificate:"
    echo "     Add to docker-compose.yml:"
    echo "     GRAPH_ETHEREUM_ALLOW_INVALID_CERTIFICATES: true"
    echo ""
    echo "  4. Use extra_hosts in docker-compose.yml:"
    echo "     extra_hosts:"
    echo "       - \"arbitrum-rpc.finmates.com:YOUR_HOST_IP\""
    echo ""
    echo "  5. Temporarily test with public RPC:"
    echo "     ethereum: 'arbitrum-one:https://arb1.arbitrum.io/rpc'"
fi
echo ""