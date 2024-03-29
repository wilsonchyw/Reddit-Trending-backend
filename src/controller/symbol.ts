import { createCanvas } from 'canvas';
import Chart from 'chart.js/auto';
import { Request } from 'express';
import Log from 'log4fns';
import { DELETE, GET, Inject, Injectable, POST, PUT } from '../lib/decorators';
import { formatDate } from '../lib/time';
import { getDaysDifference, getStartEndDate, parseToMidnight } from '../lib/timeFormat';
import RedisCache from '../services/redisCache';
import type { Symbol } from '../services/symbol';
import SymbolService from '../services/symbol';
import cryptoDict from '../variable/cryptoDict.json' assert { type: 'json' };
import stockDict from '../variable/stockDict.json' assert { type: 'json' };
import TagController from './tag';
import ThreadStateController from './threadState';
import path from 'path';
import { fileURLToPath } from 'url';

import * as fs from 'fs';

const __filename = fileURLToPath(import.meta.url);

const __dirname = path.dirname(__filename);

const oneDayInMilliseconds = 24 * 60 * 60 * 1000;

interface Change {
    [key: string]: {
        day: number | string;
        week: number | string;
        month: number | string;
    };
}

function combineStrings(s1, s2) {
    if (!s1 && !s2) return '';
    if (!s1) return s2;
    if (!s2) return s1;
    return [s1, s2].join(',');
}

enum CACHE {
    SYMBOL = 'SYMBOL'
}

@Injectable
export default class SymbolController {
    private last: null | { symbol: number } = null;

    @Inject(SymbolService)
    private readonly symbolService: SymbolService;

    @Inject(TagController)
    private readonly tagController: TagController;

    @Inject(ThreadStateController)
    private readonly threadStateController: ThreadStateController;

    @Inject(RedisCache)
    private readonly cache: RedisCache;

    @GET('/symbol/raw')
    getSymbolRaw(req: Request) {
        const type = (req.query.type as string) || 'stock';
        const [startDay, endDay] = getStartEndDate(req);
        return this.symbolService.get(startDay, endDay, type);
    }

    @GET('/symbol/one')
    getSymbolOne(req: Request) {
        const id = req.query.id as string;
        return this.symbolService.getOne(id);
    }

    @GET('/symbol')
    async getAllSymbol(req: Request) {
        try {
            const page = parseInt(req.query.page as string) || 0;
            const per_page = parseInt(req.query.per_page as string) || 25;
            const type = (req.query.type as string) || 'stock';
            const id = (req.query.id as string) || null;

            const cache = await this.cache.get(`${CACHE.SYMBOL}${type}${id}`);
            let end = page + per_page;

            if (cache) {
                Log('return from cache');
                end = Math.min(page + per_page, cache.length);
                //return cache;
                // return {
                //data: cache.sort((a, b) => b.change[sort] - a.change[sort]).slice(page, end),
                //total: cache.length
                //};
            }

            const symbolMap = {};
            const [startDay, endDay] = getStartEndDate(req);
            const daySpan = getDaysDifference(startDay, endDay);
            const symbols: Symbol[] = await this.symbolService.get(startDay, endDay, type, id);
            Log(symbols.length);

            for (const _symbol of symbols) {
                const { symbol, created, threads, verb, vote, comment, type } = _symbol;
                if (!symbolMap[symbol])
                    symbolMap[symbol] = {
                        symbol,
                        type,
                        threads: null,
                        verb: null,
                        daily: {
                            vote: Array(daySpan).fill(0),
                            comment: Array(daySpan).fill(0),
                            threads: Array(daySpan).fill(0)
                        }
                    };

                const diff = daySpan - getDaysDifference(endDay, new Date(created));
                symbolMap[symbol].daily.vote[diff] = vote; //(threads as string).split(',').length;
                symbolMap[symbol].daily.comment[diff] = comment;
                symbolMap[symbol].daily.threads[diff] = (threads as string).split(',').length;
                symbolMap[symbol].threads = combineStrings(symbolMap[symbol].threads, threads);
                symbolMap[symbol].verb = combineStrings(symbolMap[symbol].verb, verb);
            }

            /* const threadState = await this.threadStateController.getMaxVoteAndComment(req);
            Log(threadState.length);
            Log(threadState[0]);
            const threadStateMap: Record<string, ThreadStateMaxMin> = convertArrayToObject(threadState);
 */
            const result = (
                await Promise.all(
                    Object.values(symbolMap)
                        //.slice(0,10)
                        .map(async (x: any) => {
                            //console.log(x.type)
                            const { daily } = x;
                            const name = x.type == 'stock' ? stockDict[x.symbol] : cryptoDict[x.symbol];
                            const threads = [...new Set(x.threads.split(','))];
                            const verb = [...new Set(x.verb.split(','))];
                            const change: Change = {
                                vote: {
                                    day: 0,
                                    week: 0,
                                    month: 0
                                },
                                comment: {
                                    day: 0,
                                    week: 0,
                                    month: 0
                                }
                            };
                            const quantity = {
                                vote: {
                                    day: daily.vote.at(-1),
                                    week: daily.vote.at(-7),
                                    month: daily.vote[0]
                                },
                                comment: {
                                    day: daily.comment.at(-1),
                                    week: daily.comment.at(-7),
                                    month: daily.comment[0]
                                }
                            };
                            /* threads.forEach((thread: string) => {
                                change.vote.min += threadStateMap[thread].MIN_VOTE || 0;
                                change.vote.max += threadStateMap[thread].MAX_VOTE || 0;
                                change.comment.min += threadStateMap[thread].MIN_COMMENT || 0;
                                change.comment.max += threadStateMap[thread].MAX_COMMENT || 0;
                            }); */

                            change.comment.day = (daily.comment.at(-1) - daily.comment.at(-2)) / daily.comment.at(-2);

                            change.vote.day = (daily.vote.at(-1) - daily.vote.at(-2)) / daily.vote.at(-2);
                            change.comment.week = (daily.comment.at(-1) - daily.comment.at(-7)) / daily.comment.at(-7);

                            change.vote.week = (daily.vote.at(-1) - daily.vote.at(-7)) / daily.vote.at(-7);

                            change.comment.month = (daily.comment.at(-1) - daily.comment[0]) / daily.comment[0];

                            change.vote.month = (daily.vote.at(-1) - daily.vote[0]) / daily.vote[0];

                            /* change.comment.day =
                                daily.comment.at(-2) != 0
                                    ? (daily.comment.at(-1) - daily.comment.at(-2)) / daily.comment.at(-2)
                                    : 'N/A';

                            change.vote.day =
                                daily.vote.at(-2) != 0
                                    ? (daily.vote.at(-1) - daily.vote.at(-2)) / daily.vote.at(-2)
                                    : 'N/A';

                            change.comment.week =
                                daily.comment.at(-7) != 0
                                    ? (daily.comment.at(-1) - daily.comment.at(-7)) / daily.comment.at(-7)
                                    : 'N/A';

                            change.vote.week =
                                daily.vote.at(-7) != 0
                                    ? (daily.vote.at(-1) - daily.vote.at(-7)) / daily.vote.at(-7)
                                    : 'N/A';

                            change.comment.month =
                                daily.comment[0] != 0
                                    ? (daily.comment.at(-1) - daily.comment[0]) / daily.comment[0]
                                    : 'N/A';

                            change.vote.month =
                                daily.vote[0] != 0 ? (daily.vote.at(-1) - daily.vote[0]) / daily.vote[0] : 'N/A'; */

                            /* change.comment.day =
                                (daily.comment.at(-1) - daily.comment.at(-2)) /
                                (daily.comment.at(-2) == 0 ? 1 : daily.comment.at(-2));
                            change.vote.day =
                                (daily.vote.at(-1) - daily.vote.at(-2)) /
                                (daily.vote.at(-2) == 0 ? 1 : daily.vote.at(-2));

                            change.comment.week =
                                (daily.comment.at(-1) - daily.comment.at(-7)) /
                                (daily.comment.at(-7) == 0 ? 1 : daily.comment.at(-7));
                            change.vote.week =
                                (daily.vote.at(-1) - daily.vote.at(-7)) /
                                (daily.vote.at(-7) == 0 ? 1 : daily.vote.at(-7));

                            change.comment.month =
                                (daily.comment.at(-1) - daily.comment[0]) /
                                (daily.comment[0] == 0 ? 1 : daily.comment[0]);
                            change.vote.month =
                                (daily.vote.at(-1) - daily.vote[0]) / (daily.vote[0] == 0 ? 1 : daily.vote[0]); */

                            return {
                                symbol: x.symbol,
                                daily,
                                name,
                                change,
                                quantity,
                                threads,
                                verb,
                                type,
                                chart: await this.generateChart(x.daily.vote, `${x.symbol}${x.type}`)
                            };
                        })
                )
            ).filter(
                x =>
                    id ||
                    x.quantity.vote.day > 20 ||
                    x.quantity.comment.day > 20 ||
                    x.quantity.vote.week > 20 ||
                    (x.quantity.comment.week > 20 && x.type == type)
            );
            /* .map(x => {
                    const { daily, ...key } = x;
                    return {
                        ...key,
                        name: stockDict[x.symbol]
                    };
                }); */
            //.sort((a: any, b: any) => b.change.vote.max - a.change..vote.max);

            //await this.cache.set(`${CACHE.SYMBOL}${type}${id}`, result);
            end = Math.min(page + per_page, result.length);
            return result;
        } catch (e) {
            console.log(e);
            return null;
        }
    }

    //@RequestAuth
    @POST('/symbol')
    saveSymbols(req: Request) {
        let symbols = req.body;
        return this.symbolService.insert(symbols);
    }

    //@RequestAuth
    @PUT('/symbol')
    updateSymbols(req: Request) {
        let symbol = { ...req.body };
        return this.symbolService.update(symbol);
    }

    //@RequestAuth
    @DELETE('/symbol')
    deleteSymbol(req: Request) {
        let symbol = { ...req.body };
        //Log(symbol)
        return this.symbolService.delete(symbol);
    }

    @GET('/symbol/day')
    // Define the function with a Request parameter and a Promise that resolves to an array of Symbol objects
    async getDailySymbol(req: Request): Promise<Symbol[]> {
        // Extract the date parameter from the request query string
        const date = req.query.date as string;
        // Parse the date parameter to a Date object set to midnight
        const start = parseToMidnight(date);

        // Initialize empty maps to store symbols of each type
        const otherMap = {};
        const stockMap = {};
        const cryptoMap: Record<string, Symbol> = {};
        const titleMap = {};

        // Query the threadStateController for daily thread states within the specified date range
        const threadStates = await this.threadStateController.getDailybyDateRange(start);

        Log(threadStates[0]);
        // Iterate over each thread state and extract symbols from the title
        for (const threadState of threadStates) {
            const { id, title, vote, comment } = threadState;

            // Only process each thread id once
            if (!titleMap[id]) {
                // Query the tagController to get arrays of stock, crypto, other, and verb symbols from the thread title
                const { stockArr, cryptoArr, otherArr, verbArr } = await this.tagController.getSymbol(
                    title.replace('&amp;', '&')
                );

                // Process each stock symbol
                for (const stock of stockArr) {
                    if (!stockMap[stock])
                        stockMap[stock] = {
                            symbol: stock,
                            created: start,
                            threads: [],
                            verb: [],
                            type: 'stock',
                            vote: 0,
                            comment: 0
                        };
                    stockMap[stock].threads = [...new Set([...stockMap[stock].threads, id])];
                    stockMap[stock].verb = [...new Set([...stockMap[stock].verb, ...verbArr])];
                    stockMap[stock].vote += vote;
                    stockMap[stock].comment += comment;
                }

                // Process each other symbol
                for (const other of otherArr) {
                    if (!otherMap[other])
                        otherMap[other] = {
                            symbol: other,
                            created: start,
                            threads: [],
                            verb: [],
                            type: 'other',
                            vote: 0,
                            comment: 0
                        };
                    otherMap[other].threads = [...new Set([...otherMap[other].threads, id])];
                    otherMap[other].verb = [...new Set([...otherMap[other].verb, ...verbArr])];
                    otherMap[other].vote += vote;
                    otherMap[other].comment += comment;
                }

                // Process each crypto symbol
                for (const crypto of cryptoArr) {
                    if (!cryptoMap[crypto])
                        cryptoMap[crypto] = {
                            symbol: crypto,
                            created: start,
                            threads: [],
                            verb: [],
                            type: 'crypto',
                            vote: 0,
                            comment: 0
                        };
                    cryptoMap[crypto].threads = [...new Set([...cryptoMap[crypto].threads, id])];
                    cryptoMap[crypto].verb = [...new Set([...cryptoMap[crypto].verb, ...verbArr])];
                    cryptoMap[crypto].vote += vote;
                    cryptoMap[crypto].comment += comment;
                }

                // Mark this thread id as processed
                titleMap[id] = true;
            }
        }

        // Combine all the symbol maps into a single array of Symbol objects
        return [
            ...(Object.values(stockMap) as Symbol[]),
            ...(Object.values(cryptoMap) as Symbol[]),
            ...(Object.values(otherMap) as Symbol[])
        ];
    }

    @GET('/symbol/day/insert')
    async handleDailySymbol(req: Request) {
        Log("handleDailySymbol")
        const symbols = await this.getDailySymbol(req);
        Log(symbols.length);
        return this.symbolService.insert(symbols);
    }

    @GET('/symbol/test')
    async test(req: Request) {
        return this.symbolService.test();
    }

    async generateChart(data, key) {
        //Log(data)
        const cashedChart = await this.cache.get(key);
        if (cashedChart) return cashedChart;

        //const data = (req.query.date as string).split(',').map(x => parseInt(x));
        const canvas = createCanvas(150, 60) as any as HTMLCanvasElement;
        const ctx = canvas.getContext('2d');

        /* var gradient = ctx.createLinearGradient(0, 0, 0, 40);
        gradient.addColorStop(0, 'rgb(49, 56, 96)');
        gradient.addColorStop(1, 'rgba(49, 56, 96,0.7)'); */

        const options = {
            responsive: false,
            bezierCurve: false,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            layout: {
                padding: 3
            },
            scales: {
                x: {
                    display: false
                },
                y: {
                    display: false
                }
            }
        };
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.map((_, index) => index),
                datasets: [
                    {
                        data: data,
                        pointRadius: 0,
                        tension: 0.3,
                        borderWidth: 3,
                        borderColor: 'rgb(49, 56, 96)',
                        fill: false
                        //backgroundColor: gradient
                    }
                ]
            },
            options
        });
        const dataUrl = canvas.toDataURL();
        this.cache.set(key, dataUrl);
        return dataUrl;
    }

    getLatest() {
        const last = fs.existsSync(path.join(__dirname, 'last.json'))
            ? JSON.parse(fs.readFileSync(path.join(__dirname, 'last.json'), 'utf-8'))
            : {};
        if (!('symbol' in last)) last.symbol = Date.now();
        Log('Last insert symbol:', formatDate(last.symbol));
        this.last = last;
        this.updateLatest();
    }

    updateLatest() {
        fs.writeFileSync(path.join(__dirname, 'last.json'), JSON.stringify(this.last));
    }

    async handeInsertSymbol() {
        Log(__dirname);
        if (!this.last) this.getLatest();
        const timeOffset = 3600 * 12 * 1000 - (Date.now() - this.last.symbol);
        if (timeOffset <= 0) {
            this.last.symbol = Date.now();
            this.updateLatest();
            await this.handleDailySymbol({query:{ date: new Date().toJSON() }} as unknown as Request)
            setTimeout(
                () => this.handeInsertSymbol(),
                3600 * 12 * 1000
            );

            Log('inserting symbol ', formatDate(Date.now() + 3600 * 12 * 1000));
        } else {
            setTimeout(() => this.handeInsertSymbol(), timeOffset);
            Log('Scraping after ', timeOffset / 1000, 's, at ', formatDate(Date.now() + timeOffset));
        }
    }
}
