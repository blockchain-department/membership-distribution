use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

declare_id!("HpvQENGUtUqc9eHw9fEwqdsRqH57ShXEzVqXTuY9HnyM");

const RECIPIENT_SEED: &[u8] = b"recipient";
const VAULT_AUTHORITY_SEED: &[u8] = b"vault-authority";

/// CAMPAIGN CONSTANTS (Strict Compliance)
const HARD_MAX_RECIPIENTS: u16 = 120;
const CAMPAIGN_TOTAL_CAP_WHOLE: u64 = 250000;
const CAMPAIGN_EXPIRY_TS: i64 = 1775890800;

#[program]
pub mod membership_distribution {
    use super::*;

    pub fn initialize_distribution(
        ctx: Context<InitializeDistribution>,
        max_recipients: u16,
        total_cap: u64,
        expiry_ts: i64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        
        // Strict Enforcement of Campaign Requirements
        require!(
            max_recipients == HARD_MAX_RECIPIENTS,
            ErrorCode::InvalidMaxRecipients
        );
        let mint_decimals = ctx.accounts.mint.decimals;
        let expected_cap = CAMPAIGN_TOTAL_CAP_WHOLE
            .checked_mul(10u64.pow(mint_decimals as u32))
            .ok_or(ErrorCode::MathOverflow)?;
            
        require!(total_cap == expected_cap, ErrorCode::InvalidTotalCap);
        require!(expiry_ts == CAMPAIGN_EXPIRY_TS, ErrorCode::InvalidExpiry);
        require!(expiry_ts > now, ErrorCode::InvalidExpiry);

        let distribution = &mut ctx.accounts.distribution;
        distribution.authority = ctx.accounts.authority.key();
        distribution.mint = ctx.accounts.mint.key();
        distribution.vault = ctx.accounts.vault.key();
        distribution.vault_authority_bump = ctx.bumps.vault_authority;
        distribution.is_locked = false;
        distribution.is_expired = false;
        distribution.max_recipients = max_recipients;
        distribution.total_recipients = 0;
        distribution.claimed_recipients = 0;
        distribution.total_cap = total_cap;
        distribution.total_allocated = 0;
        distribution.total_distributed = 0;
        distribution.total_funded = 0;
        distribution.expiry_ts = expiry_ts;
        distribution.created_at = now;

        emit!(DistributionInitialized {
            distribution: distribution.key(),
            authority: distribution.authority,
            mint: distribution.mint,
            max_recipients,
            total_cap,
            expiry_ts,
        });
        msg!(
            "distribution={} initialized with cap={} and expiry={}",
            distribution.key(),
            total_cap,
            expiry_ts
        );

        Ok(())
    }

    pub fn register_recipient(
        ctx: Context<RegisterRecipient>,
        recipient_wallet: Pubkey,
        allocation: u64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let distribution = &mut ctx.accounts.distribution;
        assert_distribution_open(distribution, now)?;
        require!(!distribution.is_locked, ErrorCode::DistributionLocked);
        require!(allocation > 0, ErrorCode::AllocationMustBePositive);
        require!(
            distribution.total_recipients < distribution.max_recipients,
            ErrorCode::RecipientLimitReached
        );

        distribution.total_allocated = distribution
            .total_allocated
            .checked_add(allocation)
            .ok_or(ErrorCode::MathOverflow)?;
        require!(
            distribution.total_allocated <= distribution.total_cap,
            ErrorCode::CapExceeded
        );
        distribution.total_recipients = distribution
            .total_recipients
            .checked_add(1)
            .ok_or(ErrorCode::MathOverflow)?;

        let recipient = &mut ctx.accounts.recipient;
        recipient.distribution = distribution.key();
        recipient.wallet = recipient_wallet;
        recipient.allocation = allocation;
        recipient.claimed = false;
        recipient.active = true;
        recipient.bump = ctx.bumps.recipient;
        recipient.created_at = now;
        recipient.claimed_at = 0;

        emit!(RecipientRegistered {
            distribution: distribution.key(),
            wallet: recipient_wallet,
            allocation,
        });
        msg!(
            "distribution={} recipient={} allocation={}",
            distribution.key(),
            recipient_wallet,
            allocation
        );

        Ok(())
    }

    pub fn lock_distribution(ctx: Context<UpdateDistribution>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let distribution = &mut ctx.accounts.distribution;
        assert_distribution_open(distribution, now)?;
        require!(!distribution.is_locked, ErrorCode::DistributionLocked);
        require!(
            distribution.total_recipients == distribution.max_recipients,
            ErrorCode::RecipientCountNotMet
        );
        require!(
            distribution.total_allocated == distribution.total_cap,
            ErrorCode::AllocationNotComplete
        );

        distribution.is_locked = true;
        emit!(DistributionLocked {
            distribution: distribution.key(),
            total_recipients: distribution.total_recipients,
            total_allocated: distribution.total_allocated,
        });
        msg!("distribution={} locked", distribution.key());
        Ok(())
    }

    pub fn fund_vault(ctx: Context<FundVault>, amount: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        assert_distribution_open(&ctx.accounts.distribution, now)?;
        require!(
            ctx.accounts.distribution.is_locked,
            ErrorCode::DistributionNotLocked
        );
        require!(amount > 0, ErrorCode::AmountMustBePositive);

        let distribution = &mut ctx.accounts.distribution;
        distribution.total_funded = distribution
            .total_funded
            .checked_add(amount)
            .ok_or(ErrorCode::MathOverflow)?;
            
        require!(
            distribution.total_funded <= distribution.total_cap,
            ErrorCode::CapExceeded
        );

        let cpi_accounts = TransferChecked {
            from: ctx.accounts.source_token_account.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer_checked(cpi_ctx, amount, ctx.accounts.mint.decimals)?;

        emit!(VaultFunded {
            distribution: ctx.accounts.distribution.key(),
            amount,
        });
        msg!(
            "distribution={} funded amount={}",
            ctx.accounts.distribution.key(),
            amount
        );
        Ok(())
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let distribution = &mut ctx.accounts.distribution;
        assert_distribution_open(distribution, now)?;
        require!(distribution.is_locked, ErrorCode::DistributionNotLocked);

        let recipient = &mut ctx.accounts.recipient;
        require!(!recipient.claimed, ErrorCode::RecipientAlreadyClaimed);
        require!(recipient.active, ErrorCode::RecipientInactive);
        require!(
            ctx.accounts.vault.amount >= recipient.allocation,
            ErrorCode::VaultInsufficientBalance
        );

        transfer_from_vault(
            distribution,
            &ctx.accounts.mint,
            &ctx.accounts.vault,
            &ctx.accounts.vault_authority,
            &ctx.accounts.claimant_token_account,
            &ctx.accounts.token_program,
            recipient.allocation,
        )?;

        recipient.claimed = true;
        recipient.active = false;
        recipient.claimed_at = now;

        distribution.total_distributed = distribution
            .total_distributed
            .checked_add(recipient.allocation)
            .ok_or(ErrorCode::MathOverflow)?;
        require!(
            distribution.total_distributed <= distribution.total_cap,
            ErrorCode::CapExceeded
        );
        distribution.claimed_recipients = distribution
            .claimed_recipients
            .checked_add(1)
            .ok_or(ErrorCode::MathOverflow)?;

        emit!(ClaimProcessed {
            distribution: distribution.key(),
            wallet: recipient.wallet,
            amount: recipient.allocation,
            claimed_at: now,
            by_admin: false,
        });
        msg!(
            "claim processed distribution={} wallet={} amount={}",
            distribution.key(),
            recipient.wallet,
            recipient.allocation
        );
        Ok(())
    }

    pub fn admin_distribute(ctx: Context<AdminDistribute>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let distribution = &mut ctx.accounts.distribution;
        assert_distribution_open(distribution, now)?;
        require!(distribution.is_locked, ErrorCode::DistributionNotLocked);

        let recipient = &mut ctx.accounts.recipient;
        require!(!recipient.claimed, ErrorCode::RecipientAlreadyClaimed);
        require!(recipient.active, ErrorCode::RecipientInactive);
        require!(
            ctx.accounts.vault.amount >= recipient.allocation,
            ErrorCode::VaultInsufficientBalance
        );

        transfer_from_vault(
            distribution,
            &ctx.accounts.mint,
            &ctx.accounts.vault,
            &ctx.accounts.vault_authority,
            &ctx.accounts.recipient_token_account,
            &ctx.accounts.token_program,
            recipient.allocation,
        )?;

        recipient.claimed = true;
        recipient.active = false;
        recipient.claimed_at = now;

        distribution.total_distributed = distribution
            .total_distributed
            .checked_add(recipient.allocation)
            .ok_or(ErrorCode::MathOverflow)?;
        require!(
            distribution.total_distributed <= distribution.total_cap,
            ErrorCode::CapExceeded
        );
        distribution.claimed_recipients = distribution
            .claimed_recipients
            .checked_add(1)
            .ok_or(ErrorCode::MathOverflow)?;

        emit!(ClaimProcessed {
            distribution: distribution.key(),
            wallet: recipient.wallet,
            amount: recipient.allocation,
            claimed_at: now,
            by_admin: true,
        });
        msg!(
            "admin distribution processed distribution={} wallet={} amount={}",
            distribution.key(),
            recipient.wallet,
            recipient.allocation
        );
        Ok(())
    }

    pub fn invalidate_recipient(ctx: Context<InvalidateRecipient>) -> Result<()> {
        let recipient = &mut ctx.accounts.recipient;
        require!(!recipient.claimed, ErrorCode::RecipientAlreadyClaimed);
        require!(recipient.active, ErrorCode::RecipientInactive);
        recipient.active = false;

        emit!(RecipientInvalidated {
            distribution: ctx.accounts.distribution.key(),
            wallet: recipient.wallet,
        });
        msg!(
            "distribution={} recipient={} invalidated",
            ctx.accounts.distribution.key(),
            recipient.wallet
        );
        Ok(())
    }

    pub fn expire_distribution(ctx: Context<ExpireDistribution>) -> Result<()> {
        let distribution = &mut ctx.accounts.distribution;
        if distribution.is_expired {
            return Ok(());
        }

        let now = Clock::get()?.unix_timestamp;
        require!(now > distribution.expiry_ts, ErrorCode::ExpiryNotReached);
        distribution.is_expired = true;

        emit!(DistributionExpired {
            distribution: distribution.key(),
            expired_at: now,
        });
        msg!("distribution={} marked expired", distribution.key());
        Ok(())
    }

    pub fn withdraw_unclaimed(ctx: Context<WithdrawUnclaimed>, amount: u64) -> Result<()> {
        let distribution = &mut ctx.accounts.distribution;
        let now = Clock::get()?.unix_timestamp;
        require!(amount > 0, ErrorCode::AmountMustBePositive);
        require!(
            distribution.is_expired || now > distribution.expiry_ts,
            ErrorCode::ExpiryNotReached
        );
        require!(
            ctx.accounts.vault.amount >= amount,
            ErrorCode::VaultInsufficientBalance
        );

        distribution.is_expired = true;
        transfer_from_vault(
            distribution,
            &ctx.accounts.mint,
            &ctx.accounts.vault,
            &ctx.accounts.vault_authority,
            &ctx.accounts.destination_token_account,
            &ctx.accounts.token_program,
            amount,
        )?;

        emit!(UnclaimedWithdrawn {
            distribution: distribution.key(),
            amount,
            withdrawn_at: now,
        });
        msg!(
            "distribution={} unclaimed withdrawn amount={}",
            distribution.key(),
            amount
        );
        Ok(())
    }
}

fn assert_distribution_open(distribution: &DistributionState, now: i64) -> Result<()> {
    require!(
        !distribution.is_expired && now <= distribution.expiry_ts,
        ErrorCode::DistributionExpired
    );
    Ok(())
}

fn transfer_from_vault<'info>(
    distribution: &Account<'info, DistributionState>,
    mint: &Account<'info, Mint>,
    vault: &Account<'info, TokenAccount>,
    vault_authority: &UncheckedAccount<'info>,
    destination: &Account<'info, TokenAccount>,
    token_program: &Program<'info, Token>,
    amount: u64,
) -> Result<()> {
    let distribution_key = distribution.key();
    let bump = [distribution.vault_authority_bump];
    let signer_seeds: &[&[u8]] = &[VAULT_AUTHORITY_SEED, distribution_key.as_ref(), &bump];
    let signer: &[&[&[u8]]] = &[signer_seeds];

    let cpi_accounts = TransferChecked {
        from: vault.to_account_info(),
        mint: mint.to_account_info(),
        to: destination.to_account_info(),
        authority: vault_authority.to_account_info(),
    };
    let cpi_ctx =
        CpiContext::new_with_signer(token_program.to_account_info(), cpi_accounts, signer);
    token::transfer_checked(cpi_ctx, amount, mint.decimals)?;

    Ok(())
}

#[derive(Accounts)]
pub struct InitializeDistribution<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + DistributionState::LEN
    )]
    pub distribution: Account<'info, DistributionState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        seeds = [VAULT_AUTHORITY_SEED, distribution.key().as_ref()],
        bump
    )]
    /// CHECK: This PDA is only used as a signing authority for the vault.
    pub vault_authority: UncheckedAccount<'info>,
    #[account(
        init,
        payer = authority,
        associated_token::mint = mint,
        associated_token::authority = vault_authority
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(recipient_wallet: Pubkey)]
pub struct RegisterRecipient<'info> {
    #[account(mut, has_one = authority @ ErrorCode::Unauthorized)]
    pub distribution: Account<'info, DistributionState>,
    #[account(
        init,
        payer = authority,
        space = 8 + RecipientState::LEN,
        seeds = [RECIPIENT_SEED, distribution.key().as_ref(), recipient_wallet.as_ref()],
        bump
    )]
    pub recipient: Account<'info, RecipientState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateDistribution<'info> {
    #[account(mut, has_one = authority @ ErrorCode::Unauthorized)]
    pub distribution: Account<'info, DistributionState>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct FundVault<'info> {
    #[account(
        mut,
        has_one = authority @ ErrorCode::Unauthorized,
        has_one = mint @ ErrorCode::InvalidMint,
        constraint = distribution.vault == vault.key() @ ErrorCode::InvalidVault
    )]
    pub distribution: Account<'info, DistributionState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        constraint = source_token_account.owner == authority.key() @ ErrorCode::InvalidSourceOwner,
        constraint = source_token_account.mint == mint.key() @ ErrorCode::InvalidMint
    )]
    pub source_token_account: Account<'info, TokenAccount>,
    #[account(mut, address = distribution.vault @ ErrorCode::InvalidVault)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(
        mut,
        has_one = mint @ ErrorCode::InvalidMint,
        constraint = distribution.vault == vault.key() @ ErrorCode::InvalidVault
    )]
    pub distribution: Account<'info, DistributionState>,
    #[account(
        mut,
        seeds = [RECIPIENT_SEED, distribution.key().as_ref(), claimant.key().as_ref()],
        bump = recipient.bump,
        constraint = recipient.wallet == claimant.key() @ ErrorCode::InvalidRecipient,
        constraint = recipient.distribution == distribution.key() @ ErrorCode::InvalidDistribution
    )]
    pub recipient: Account<'info, RecipientState>,
    #[account(mut)]
    pub claimant: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        seeds = [VAULT_AUTHORITY_SEED, distribution.key().as_ref()],
        bump = distribution.vault_authority_bump
    )]
    /// CHECK: This PDA is only used as a signing authority for the vault.
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut, address = distribution.vault @ ErrorCode::InvalidVault)]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = claimant,
        associated_token::mint = mint,
        associated_token::authority = claimant
    )]
    pub claimant_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminDistribute<'info> {
    #[account(
        mut,
        has_one = authority @ ErrorCode::Unauthorized,
        has_one = mint @ ErrorCode::InvalidMint,
        constraint = distribution.vault == vault.key() @ ErrorCode::InvalidVault
    )]
    pub distribution: Account<'info, DistributionState>,
    #[account(
        mut,
        seeds = [RECIPIENT_SEED, distribution.key().as_ref(), recipient.wallet.as_ref()],
        bump = recipient.bump,
        constraint = recipient.distribution == distribution.key() @ ErrorCode::InvalidDistribution
    )]
    pub recipient: Account<'info, RecipientState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: Recipient wallet is validated against the recipient state.
    #[account(mut, address = recipient.wallet @ ErrorCode::InvalidRecipient)]
    pub recipient_wallet: UncheckedAccount<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        seeds = [VAULT_AUTHORITY_SEED, distribution.key().as_ref()],
        bump = distribution.vault_authority_bump
    )]
    /// CHECK: This PDA is only used as a signing authority for the vault.
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut, address = distribution.vault @ ErrorCode::InvalidVault)]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = mint,
        associated_token::authority = recipient_wallet
    )]
    pub recipient_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InvalidateRecipient<'info> {
    #[account(has_one = authority @ ErrorCode::Unauthorized)]
    pub distribution: Account<'info, DistributionState>,
    #[account(
        mut,
        seeds = [RECIPIENT_SEED, distribution.key().as_ref(), recipient.wallet.as_ref()],
        bump = recipient.bump,
        constraint = recipient.distribution == distribution.key() @ ErrorCode::InvalidDistribution
    )]
    pub recipient: Account<'info, RecipientState>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ExpireDistribution<'info> {
    #[account(mut)]
    pub distribution: Account<'info, DistributionState>,
}

#[derive(Accounts)]
pub struct WithdrawUnclaimed<'info> {
    #[account(
        mut,
        has_one = authority @ ErrorCode::Unauthorized,
        has_one = mint @ ErrorCode::InvalidMint,
        constraint = distribution.vault == vault.key() @ ErrorCode::InvalidVault
    )]
    pub distribution: Account<'info, DistributionState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        seeds = [VAULT_AUTHORITY_SEED, distribution.key().as_ref()],
        bump = distribution.vault_authority_bump
    )]
    /// CHECK: This PDA is only used as a signing authority for the vault.
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut, address = distribution.vault @ ErrorCode::InvalidVault)]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = destination_token_account.owner == authority.key() @ ErrorCode::InvalidDestinationOwner,
        constraint = destination_token_account.mint == mint.key() @ ErrorCode::InvalidMint
    )]
    pub destination_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct DistributionState {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub vault_authority_bump: u8,
    pub is_locked: bool,
    pub is_expired: bool,
    pub max_recipients: u16,
    pub total_recipients: u16,
    pub claimed_recipients: u16,
    pub total_cap: u64,
    pub total_allocated: u64,
    pub total_distributed: u64,
    pub total_funded: u64,
    pub expiry_ts: i64,
    pub created_at: i64,
}

impl DistributionState {
    pub const LEN: usize = 32 + 32 + 32 + 1 + 1 + 1 + 2 + 2 + 2 + 8 + 8 + 8 + 8 + 8 + 8;
}

#[account]
pub struct RecipientState {
    pub distribution: Pubkey,
    pub wallet: Pubkey,
    pub allocation: u64,
    pub claimed: bool,
    pub active: bool,
    pub bump: u8,
    pub created_at: i64,
    pub claimed_at: i64,
}

impl RecipientState {
    pub const LEN: usize = 32 + 32 + 8 + 1 + 1 + 1 + 8 + 8;
}

#[event]
pub struct DistributionInitialized {
    pub distribution: Pubkey,
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub max_recipients: u16,
    pub total_cap: u64,
    pub expiry_ts: i64,
}

#[event]
pub struct RecipientRegistered {
    pub distribution: Pubkey,
    pub wallet: Pubkey,
    pub allocation: u64,
}

#[event]
pub struct DistributionLocked {
    pub distribution: Pubkey,
    pub total_recipients: u16,
    pub total_allocated: u64,
}

#[event]
pub struct VaultFunded {
    pub distribution: Pubkey,
    pub amount: u64,
}

#[event]
pub struct ClaimProcessed {
    pub distribution: Pubkey,
    pub wallet: Pubkey,
    pub amount: u64,
    pub claimed_at: i64,
    pub by_admin: bool,
}

#[event]
pub struct RecipientInvalidated {
    pub distribution: Pubkey,
    pub wallet: Pubkey,
}

#[event]
pub struct DistributionExpired {
    pub distribution: Pubkey,
    pub expired_at: i64,
}

#[event]
pub struct UnclaimedWithdrawn {
    pub distribution: Pubkey,
    pub amount: u64,
    pub withdrawn_at: i64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Campaign must have exactly 5 recipients.")]
    InvalidMaxRecipients,
    #[msg("Campaign must have total cap of exactly 250,000 tokens.")]
    InvalidTotalCap,
    #[msg("Expiry timestamp must be set to required compaign expiry timestamp in the future.")]
    InvalidExpiry,
    #[msg("Recipient allocation must be greater than zero.")]
    AllocationMustBePositive,
    #[msg("Amount must be greater than zero.")]
    AmountMustBePositive,
    #[msg("The distribution is already locked.")]
    DistributionLocked,
    #[msg("The distribution must be locked before this action.")]
    DistributionNotLocked,
    #[msg("The distribution is expired and no further claims are allowed.")]
    DistributionExpired,
    #[msg("Maximum recipient count reached.")]
    RecipientLimitReached,
    #[msg("Total allocation would exceed configured cap.")]
    CapExceeded,
    #[msg("Math overflow.")]
    MathOverflow,
    #[msg("Recipient has already claimed.")]
    RecipientAlreadyClaimed,
    #[msg("Recipient is inactive.")]
    RecipientInactive,
    #[msg("Unauthorized operation.")]
    Unauthorized,
    #[msg("Invalid mint account.")]
    InvalidMint,
    #[msg("Invalid vault account.")]
    InvalidVault,
    #[msg("Invalid recipient account.")]
    InvalidRecipient,
    #[msg("Recipient does not belong to this distribution.")]
    InvalidDistribution,
    #[msg("Source token account is not owned by authority.")]
    InvalidSourceOwner,
    #[msg("Destination token account is not owned by authority.")]
    InvalidDestinationOwner,
    #[msg("All configured recipients must be registered before locking.")]
    RecipientCountNotMet,
    #[msg("Allocations must sum exactly to the configured cap before locking.")]
    AllocationNotComplete,
    #[msg("Expiry timestamp has not been reached yet.")]
    ExpiryNotReached,
    #[msg("Vault does not hold enough tokens for this transfer.")]
    VaultInsufficientBalance,
}
