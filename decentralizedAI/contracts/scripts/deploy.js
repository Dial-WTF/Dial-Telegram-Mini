const hre = require("hardhat");

async function main() {
  console.log("Deploying GlyphToken contract...");

  // Get the contract factory
  const GlyphToken = await hre.ethers.getContractFactory("GlyphToken");
  
  // Deploy the contract
  const glyphToken = await GlyphToken.deploy();
  await glyphToken.waitForDeployment();

  const address = await glyphToken.getAddress();
  console.log("GlyphToken deployed to:", address);
  console.log("Network:", hre.network.name);
  
  // Wait for a few block confirmations before verifying
  if (hre.network.name !== "hardhat" && hre.network.name !== "localhost") {
    console.log("Waiting for block confirmations...");
    await glyphToken.deploymentTransaction().wait(6);
    
    console.log("Verifying contract on block explorer...");
    try {
      await hre.run("verify:verify", {
        address: address,
        constructorArguments: [],
      });
      console.log("Contract verified!");
    } catch (error) {
      console.log("Verification error:", error.message);
    }
  }
  
  // Save deployment info
  const fs = require("fs");
  const deploymentInfo = {
    network: hre.network.name,
    contractAddress: address,
    deployedAt: new Date().toISOString(),
    deployer: (await hre.ethers.getSigners())[0].address
  };
  
  fs.writeFileSync(
    `deployment-${hre.network.name}.json`,
    JSON.stringify(deploymentInfo, null, 2)
  );
  
  console.log("\nDeployment complete!");
  console.log("Contract address:", address);
  console.log("Save this address in your .env file as GLYPH_TOKEN_ADDRESS");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
