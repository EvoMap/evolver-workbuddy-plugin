#!/usr/bin/env node
import { answer, commandInput } from '../lib/command-output.mjs';
import { argumentsOf, runEvolverCli } from '../lib/evolver-cli.mjs';

const [subcommand] = process.argv.slice(2);
answer(await runEvolverCli([subcommand, ...argumentsOf(commandInput())]));
