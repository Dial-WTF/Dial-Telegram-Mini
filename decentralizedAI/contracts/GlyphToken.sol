// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title GlyphToken
 * @dev ERC20 token for rewarding decentralized AI compute contributors
 * 
 * Features:
 * - Mintable by owner (for epoch-based reward distribution)
 * - Burnable (allow users to burn their tokens)
 * - Pausable (emergency stop mechanism)
 * - Batch minting for gas efficiency
 */
contract GlyphToken is ERC20, ERC20Burnable, Ownable, Pausable {
    // Maximum supply: 21 million GLYPH (with 18 decimals)
    uint256 public constant MAX_SUPPLY = 21_000_000 * 10**18;
    
    // Events
    event RewardsMinted(address indexed recipient, uint256 amount, string epochId);
    event BatchRewardsMinted(uint256 totalAmount, uint256 recipientCount, string epochId);
    
    constructor() ERC20("Glyph Network Token", "GLYPH") {
        // Initial supply can be minted to deployer or kept at 0
        // For decentralized model, start with 0 and mint rewards over time
    }
    
    /**
     * @dev Mint rewards to a single contributor
     * @param to Address of the contributor
     * @param amount Amount of tokens to mint
     * @param epochId Identifier for the reward epoch (for tracking)
     */
    function mintReward(
        address to, 
        uint256 amount,
        string memory epochId
    ) external onlyOwner whenNotPaused {
        require(to != address(0), "Cannot mint to zero address");
        require(amount > 0, "Amount must be greater than 0");
        require(totalSupply() + amount <= MAX_SUPPLY, "Would exceed max supply");
        
        _mint(to, amount);
        emit RewardsMinted(to, amount, epochId);
    }
    
    /**
     * @dev Batch mint rewards to multiple contributors (gas efficient)
     * @param recipients Array of contributor addresses
     * @param amounts Array of token amounts (must match recipients length)
     * @param epochId Identifier for the reward epoch
     */
    function batchMintRewards(
        address[] memory recipients,
        uint256[] memory amounts,
        string memory epochId
    ) external onlyOwner whenNotPaused {
        require(recipients.length == amounts.length, "Arrays length mismatch");
        require(recipients.length > 0, "Empty arrays");
        require(recipients.length <= 100, "Too many recipients (max 100)");
        
        uint256 totalAmount = 0;
        for (uint256 i = 0; i < recipients.length; i++) {
            require(recipients[i] != address(0), "Cannot mint to zero address");
            require(amounts[i] > 0, "Amount must be greater than 0");
            
            totalAmount += amounts[i];
            _mint(recipients[i], amounts[i]);
        }
        
        require(totalSupply() <= MAX_SUPPLY, "Would exceed max supply");
        emit BatchRewardsMinted(totalAmount, recipients.length, epochId);
    }
    
    /**
     * @dev Pause token transfers (emergency use)
     */
    function pause() external onlyOwner {
        _pause();
    }
    
    /**
     * @dev Unpause token transfers
     */
    function unpause() external onlyOwner {
        _unpause();
    }
    
    /**
     * @dev Override transfer to add pausable functionality
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override whenNotPaused {
        super._beforeTokenTransfer(from, to, amount);
    }
}
