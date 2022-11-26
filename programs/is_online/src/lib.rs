use anchor_lang::prelude::*;

declare_id!("4yBhDin4eMVsgGEKpKgAhHDJycnBesaV8yMzb38QzAKZ");

#[program]
pub mod is_online {
    use super::*;

    pub fn init_game(
        ctx: Context<GameInit>,
        player_two: Pubkey,
        pot: u64,
        round_time: u32,
        win_threshold: u8,
    ) -> Result<()> {
        if let Err(err) = ctx.accounts.escrow.init(
            [ctx.accounts.player_one.key(), player_two],
            pot,
            round_time,
            win_threshold,
        ) {
            return Err(err);
        };
        if let Err(err) = anchor_lang::system_program::transfer(
            anchor_lang::context::CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.player_one.to_account_info(),
                    to: ctx.accounts.escrow.to_account_info(),
                },
            ),
            pot / 2,
        ) {
            return Err(err);
        }
        Ok(())
    }

    pub fn join_game(ctx: Context<GameJoin>) -> Result<()> {
        if let Err(err) = ctx.accounts.escrow.join() {
            return Err(err);
        };
        if let Err(err) = anchor_lang::system_program::transfer(
            anchor_lang::context::CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.player_two.to_account_info(),
                    to: ctx.accounts.escrow.to_account_info(),
                },
            ),
            ctx.accounts.escrow.pot / 2,
        ) {
            return Err(err);
        }

        Ok(())
    }

    pub fn start_round(ctx: Context<RoundStart>) -> Result<()> {
        ctx.accounts.escrow.start()
    }

    pub fn respond_round(ctx: Context<RoundRespond>) -> Result<()> {
        ctx.accounts.escrow.respond()
    }

    pub fn end_round(ctx: Context<GameCtx>) -> Result<()> {
        ctx.accounts.escrow.end_round()
    }

    pub fn end_game(ctx: Context<GameEnd>) -> anchor_lang::Result<()> {
        match ctx.accounts.escrow.end_game() {
            Ok(is_player_one_winner) => {
                let mut winnings = ctx.accounts.escrow.pot / 2;
                if ctx.accounts.escrow.to_account_info().lamports() > ctx.accounts.escrow.pot {
                    winnings += ctx.accounts.escrow.pot / 2;
                }

                let winner = if is_player_one_winner {
                    ctx.accounts.player_one.to_account_info()
                } else {
                    ctx.accounts.player_two.to_account_info()
                };

                match ctx
                    .accounts
                    .escrow
                    .to_account_info()
                    .try_borrow_mut_lamports()
                {
                    Ok(mut escrow_lamports) => {
                        **escrow_lamports -= winnings;
                    }
                    Err(err) => return Err(err.into()),
                };
                match winner.try_borrow_mut_lamports() {
                    Ok(mut winner_lamports) => {
                        **winner_lamports += winnings;
                    }
                    Err(err) => return Err(err.into()),
                };
            }

            Err(err) => return Err(err),
        }
        Ok(())
    }
}

#[derive(Accounts)]
pub struct GameInit<'info> {
    #[account()]
    /// CHECK: Not reading or writing to game
    game: UncheckedAccount<'info>,
    #[account(init, payer = player_one, space = 121, seeds = [b"IsOnlineGame", game.key().as_ref()], bump)]
    escrow: Account<'info, Escrow>,
    #[account(mut)]
    player_one: Signer<'info>,
    system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct GameJoin<'info> {
    #[account()]
    /// CHECK: Not reading or writing to game
    game: UncheckedAccount<'info>,
    #[account(mut, seeds = [b"IsOnlineGame", game.key().as_ref()], bump)]
    escrow: Account<'info, Escrow>,
    #[account(mut, constraint = escrow.players[1] == player_two.key())]
    player_two: Signer<'info>,
    system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RoundStart<'info> {
    #[account()]
    /// CHECK: Not reading or writing to game
    game: UncheckedAccount<'info>,
    #[account(mut, seeds = [b"IsOnlineGame", game.key().as_ref()], bump)]
    escrow: Account<'info, Escrow>,
    #[account(constraint = escrow.players[0] == player_one.key())]
    player_one: Signer<'info>,
}

#[derive(Accounts)]
pub struct RoundRespond<'info> {
    #[account()]
    /// CHECK: Not reading or writing to game
    game: UncheckedAccount<'info>,
    #[account(mut, seeds = [b"IsOnlineGame", game.key().as_ref()], bump)]
    escrow: Account<'info, Escrow>,
    #[account(constraint = escrow.players[1] == player_two.key())]
    player_two: Signer<'info>,
}

#[derive(Accounts)]
pub struct GameEnd<'info> {
    #[account()]
    /// CHECK: Not reading or writing to Game
    game: UncheckedAccount<'info>,
    #[account(mut, seeds = [b"IsOnlineGame", game.key().as_ref()], bump)]
    escrow: Account<'info, Escrow>,
    #[account(mut, constraint = escrow.players[0] == player_one.key())]
    /// CHECK: Not reading or writing to player_one
    player_one: UncheckedAccount<'info>,
    #[account(mut, constraint = escrow.players[1] == player_two.key())]
    /// CHECK: Not reading or writing to player_two
    player_two: UncheckedAccount<'info>,
    system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct GameCtx<'info> {
    #[account()]
    /// CHECK: Not reading or writing to Game
    game: UncheckedAccount<'info>,
    #[account(mut, seeds = [b"IsOnlineGame", game.key().as_ref()], bump)]
    escrow: Account<'info, Escrow>,
    system_program: Program<'info, System>,
}

#[account]
pub struct Game {}

#[account]
pub struct Escrow {
    // discriminator       // 8
    players: [Pubkey; 2],  // 64
    pot: u64,              // 8
    round_time: u32,       // 4
    score: i16,            // 2
    round: u8,             // 1
    win_threshold: u8,     // 1
    game_state: GameState, // 33
} // 121

impl Escrow {
    pub fn init(
        &mut self,
        players: [Pubkey; 2],
        pot: u64,
        round_time: u32,
        win_threashhold: u8,
    ) -> Result<()> {
        self.players = players;
        self.pot = pot;
        self.round_time = round_time;
        self.win_threshold = win_threashhold;
        self.round = 1;
        self.game_state = GameState::Created;

        Ok(())
    }

    pub fn join(&mut self) -> Result<()> {
        if let GameState::Created = self.game_state {
            self.game_state = GameState::Inactive;
            return Ok(());
        } else {
            return err!(IsOnlineError::JoinError);
        }
    }

    pub fn start(&mut self) -> Result<()> {
        match self.game_state {
            GameState::Inactive => {
                self.game_state = GameState::Active {
                    start_time: Clock::get().unwrap().unix_timestamp,
                };
                self.score += 1;
            }
            _ => {
                return err!(IsOnlineError::StartError);
            }
        }

        Ok(())
    }

    pub fn respond(&mut self) -> Result<()> {
        match self.game_state {
            GameState::Active { start_time } => {
                require_gt!(
                    start_time + i64::from(self.round_time),
                    Clock::get().unwrap().unix_timestamp,
                    IsOnlineError::RespondError
                );
                self.score -= 2;
            }
            _ => {
                return err!(IsOnlineError::RespondError);
            }
        }
        Ok(())
    }

    pub fn end_round(&mut self) -> Result<()> {
        match self.game_state {
            GameState::Active { start_time } => {
                require_gt!(
                    Clock::get().unwrap().unix_timestamp,
                    start_time + i64::from(self.round_time),
                    IsOnlineError::EndRoundError
                );
                self.game_state = GameState::Inactive;
                self.round += 1;
            }
            _ => {
                return err!(IsOnlineError::EndRoundError);
            }
        }

        Ok(())
    }

    pub fn end_game(&mut self) -> Result<bool> {
        if let GameState::Created = self.game_state {
            self.game_state = GameState::Failed;
            return Ok(true);
        } else if let GameState::Inactive = self.game_state {
            if self.score >= i16::from(self.win_threshold) {
                self.game_state = GameState::Finished {
                    winner: self.players[0],
                };
                return Ok(true);
            } else if self.score <= -i16::from(self.win_threshold) {
                self.game_state = GameState::Finished {
                    winner: self.players[1],
                };
                return Ok(false);
            }
        }
        return err!(IsOnlineError::EndGameError);
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Copy, Clone, PartialEq, Eq)]
pub enum GameState {
    Undefined,
    Created,
    Active { start_time: i64 },
    Inactive,
    Finished { winner: Pubkey },
    Failed,
}

#[error_code]
pub enum IsOnlineError {
    JoinError,
    StartError,
    RespondError,
    EndRoundError,
    EndGameError,
}
