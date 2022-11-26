import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { prototype } from "mocha";
import { IsOnline } from "../target/types/is_online";

chai.use(chaiAsPromised);
var expect = chai.expect;

describe("is_online", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.IsOnline as Program<IsOnline>;
  const programProvider = program.provider as anchor.AnchorProvider;
  const playerOne = programProvider.wallet;

  const playerTwo = anchor.web3.Keypair.generate();
  const pot = new anchor.BN("10000000000");

  it("Can Create Game", async () => {
    const game = anchor.web3.Keypair.generate();
    const round_time = 1;
    const win_threshold = 2;

    const [escrow_pubkey, _] = await anchor.web3.PublicKey.findProgramAddress(
      [anchor.utils.bytes.utf8.encode("IsOnlineGame"), game.publicKey.toBuffer()],
      program.programId
    );

    const tx = program.methods
      .initGame(playerTwo.publicKey, pot, round_time, win_threshold)
      .accounts({
        game: game.publicKey,
        escrow: escrow_pubkey,
        playerOne: playerOne.publicKey,
      })
      .rpc();
    const escrow_data = program.account.escrow.fetch(escrow_pubkey);

    expect(tx).eventually.is.string;
    expect(escrow_data)
      .eventually.property("gameState")
      .to.deep.equal({ initalized: {} });
    expect(escrow_data).eventually.property("round").to.equal(1);
    await tx;
    return expect(
      programProvider.connection.getBalance(escrow_pubkey)
    ).to.eventually.be.gte(pot.toNumber() / 2);
  });

  it("Can Start Game", async () => {
    const game = anchor.web3.Keypair.generate();
    const round_time = 1;
    const win_threshold = 2;

    let transferPlayerTwo = programProvider.sendAndConfirm(
      new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: playerOne.publicKey,
          toPubkey: playerTwo.publicKey,
          lamports: pot.toNumber() / 2,
        })
      )
    );

    const [escrow_pubkey, _] = await anchor.web3.PublicKey.findProgramAddress(
      [anchor.utils.bytes.utf8.encode("IsOnlineGame"), game.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .initGame(playerTwo.publicKey, pot, round_time, win_threshold)
      .accounts({
        game: game.publicKey,
        escrow: escrow_pubkey,
        playerOne: playerOne.publicKey,
      })
      .rpc();

    await transferPlayerTwo;

    const tx = program.methods
      .joinGame()
      .accounts({
        game: game.publicKey,
        escrow: escrow_pubkey,
        playerTwo: playerTwo.publicKey,
      })
      .signers([playerTwo])
      .rpc();
    const escrow_data = program.account.escrow.fetch(escrow_pubkey);

    expect(tx).eventually.is.string;
    expect(escrow_data)
      .eventually.property("gameState")
      .to.deep.equal({ created: {} });
    await tx;
    return expect(
      programProvider.connection.getBalance(escrow_pubkey)
    ).to.eventually.be.gte(pot.toNumber());
  });

  it("Can PlayerOne Win Game", async () => {
    const sleep = (s: number) =>
      new Promise((resolve) => setTimeout(resolve, s * 1000));

    const game = anchor.web3.Keypair.generate();
    const round_time = 1;
    const win_threshold = 2;

    const playerOneStartingBalance =
      await programProvider.connection.getBalance(playerOne.publicKey);

    const transferPlayerTwo = programProvider.sendAndConfirm(
      new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: playerOne.publicKey,
          toPubkey: playerTwo.publicKey,
          lamports: pot.toNumber() / 2,
        })
      )
    );

    const [escrow_pubkey, _] = await anchor.web3.PublicKey.findProgramAddress(
      [anchor.utils.bytes.utf8.encode("IsOnlineGame"), game.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .initGame(playerTwo.publicKey, pot, round_time, win_threshold)
      .accounts({
        game: game.publicKey,
        escrow: escrow_pubkey,
        playerOne: playerOne.publicKey,
      })
      .rpc();

    await transferPlayerTwo;

    await program.methods
      .joinGame()
      .accounts({
        game: game.publicKey,
        escrow: escrow_pubkey,
        playerTwo: playerTwo.publicKey,
      })
      .signers([playerTwo])
      .rpc();

    await program.methods
      .startRound()
      .accounts({
        game: game.publicKey,
        escrow: escrow_pubkey,
        playerOne: playerOne.publicKey,
      })
      .rpc();

    await sleep(round_time + 2);

    await program.methods
      .endRound()
      .accounts({
        game: game.publicKey,
        escrow: escrow_pubkey,
      })
      .rpc();

    await program.methods
      .startRound()
      .accounts({
        game: game.publicKey,
        escrow: escrow_pubkey,
        playerOne: playerOne.publicKey,
      })
      .rpc();

    await sleep(round_time + 2);

    await program.methods
      .endRound()
      .accounts({
        game: game.publicKey,
        escrow: escrow_pubkey,
      })
      .rpc();

    let tx = program.methods
      .endGame()
      .accounts({
        game: game.publicKey,
        escrow: escrow_pubkey,
        playerOne: playerOne.publicKey,
        playerTwo: playerTwo.publicKey,
      })
      .rpc();
    const escrow_data = program.account.escrow.fetch(escrow_pubkey);

    expect(tx).eventually.is.string;
    expect(escrow_data)
      .eventually.property("gameState")
      .to.deep.equal({ finished: { winner: playerOne.publicKey } });
    await tx;
    expect(programProvider.connection.getBalance(escrow_pubkey))
      .to.eventually.be.lte(pot.toNumber())
      .and.to.be.gt(0);

    return expect(
      programProvider.connection.getBalance(playerOne.publicKey)
    ).to.eventually.be.approximately(playerOneStartingBalance, 10_000_000);
  });

  it("Can PlayerTwo Win Game", async () => {
    const sleep = (s: number) =>
      new Promise((resolve) => setTimeout(resolve, s * 1000));

    const game = anchor.web3.Keypair.generate();
    const round_time = 3;
    const win_threshold = 2;

    const playerOneStartingBalance =
      await programProvider.connection.getBalance(playerOne.publicKey);

    const transferPlayerTwo = programProvider.sendAndConfirm(
      new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: playerOne.publicKey,
          toPubkey: playerTwo.publicKey,
          lamports: pot.toNumber() / 2,
        })
      )
    );

    const [escrow_pubkey, _] = await anchor.web3.PublicKey.findProgramAddress(
      [anchor.utils.bytes.utf8.encode("IsOnlineGame"), game.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .initGame(playerTwo.publicKey, pot, round_time, win_threshold)
      .accounts({
        game: game.publicKey,
        escrow: escrow_pubkey,
        playerOne: playerOne.publicKey,
      })
      .rpc();

    await transferPlayerTwo;

    await program.methods
      .joinGame()
      .accounts({
        game: game.publicKey,
        escrow: escrow_pubkey,
        playerTwo: playerTwo.publicKey,
      })
      .signers([playerTwo])
      .rpc();

    await program.methods
      .startRound()
      .accounts({
        game: game.publicKey,
        escrow: escrow_pubkey,
        playerOne: playerOne.publicKey,
      })
      .rpc();

    await program.methods
      .respondRound()
      .accounts({
        game: game.publicKey,
        escrow: escrow_pubkey,
        playerTwo: playerTwo.publicKey,
      })
      .signers([playerTwo])
      .rpc();

    await sleep(round_time + 2);

    await program.methods
      .endRound()
      .accounts({
        game: game.publicKey,
        escrow: escrow_pubkey,
      })
      .rpc();

    await program.methods
      .startRound()
      .accounts({
        game: game.publicKey,
        escrow: escrow_pubkey,
        playerOne: playerOne.publicKey,
      })
      .rpc();

    await program.methods
      .respondRound()
      .accounts({
        game: game.publicKey,
        escrow: escrow_pubkey,
        playerTwo: playerTwo.publicKey,
      })
      .signers([playerTwo])
      .rpc();

    await sleep(round_time + 2);

    await program.methods
      .endRound()
      .accounts({
        game: game.publicKey,
        escrow: escrow_pubkey,
      })
      .rpc();

    let tx = program.methods
      .endGame()
      .accounts({
        game: game.publicKey,
        escrow: escrow_pubkey,
        playerOne: playerOne.publicKey,
        playerTwo: playerTwo.publicKey,
      })
      .rpc();
    const escrow_data = program.account.escrow.fetch(escrow_pubkey);

    expect(tx).eventually.is.string;
    expect(escrow_data)
      .eventually.property("gameState")
      .to.deep.equal({ finished: { winner: playerTwo.publicKey } });
    await tx;
    expect(programProvider.connection.getBalance(escrow_pubkey))
      .to.eventually.be.lte(pot.toNumber())
      .and.to.be.gt(0);

    return expect(
      programProvider.connection.getBalance(playerTwo.publicKey)
    ).to.eventually.be.eql(pot.toNumber());
  });
});
