import { Boom } from '@hapi/boom'
import NodeCache from 'node-cache'
import readline from 'readline'
import makeWASocket, { AnyMessageContent, BinaryInfo, delay, DisconnectReason, downloadAndProcessHistorySyncNotification, encodeWAM, fetchLatestBaileysVersion, getAggregateVotesInPollMessage, getHistoryMsg, isJidNewsletter, makeCacheableSignalKeyStore, makeInMemoryStore, proto, useMultiFileAuthState, WAMessageContent, WAMessageKey } from '@whiskeysockets/baileys'
import qrcode from 'qrcode-terminal'
//import MAIN_LOGGER from '../src/Utils/logger'
import fs from 'fs'
import P from 'pino'

const logger = P({ timestamp: () => `,"time":"${new Date().toJSON()}"` }, P.destination('./wa-logs.txt'))
logger.level = 'trace'

const useStore = !process.argv.includes('--no-store')
const doReplies = process.argv.includes('--do-reply')
const usePairingCode = process.argv.includes('--use-pairing-code')

// external map to store retry counts of messages when decryption/encryption fails
// keep this out of the socket itself, so as to prevent a message decryption/encryption loop across socket restarts
const msgRetryCounterCache = new NodeCache()

const onDemandMap = new Map<string, string>()

// Move readline interface to global scope
let rl: readline.Interface;
const initReadline = () => {
    rl = readline.createInterface({ 
        input: process.stdin, 
        output: process.stdout 
    });
};

const question = (text: string) => new Promise<string>((resolve) => {
    if (!rl) {
        initReadline();
    }
    rl.question(text, resolve);
});

// the store maintains the data of the WA connection in memory
// can be written out to a file & read from it
const store = useStore ? makeInMemoryStore({ logger }) : undefined
store?.readFromFile('./store_multi.json')
// save every 10s
setInterval(() => {
	store?.writeToFile('./store_multi.json')
}, 10_000)

const showMenu = () => {
	console.log('1. Start Test');
	console.log('2. Exit');
}

// Modify handleUserInput to handle errors
const handleUserInput = async (sock: any) => {
    try {
        showMenu();
        const choice = await question('Enter your choice: ');

        switch (choice) {
            case '1':
                const jid = await question('Enter the JID to send test messages: ');
                await startTest(sock, jid);
                // Re-show menu after test completes
                await handleUserInput(sock);
                break;
            case '2':
                if (rl) {
                    rl.close();
                }
                console.log('Exiting...');
                process.exit(0);
                break;
            default:
                console.log('Invalid choice. Please try again.');
                await handleUserInput(sock);
                break;
        }
    } catch (error: unknown) {
        // Type guard for the error object
        if (error && typeof error === 'object' && 'code' in error) {
            if (error.code === 'ERR_USE_AFTER_CLOSE') {
                // Readline was closed, reinitialize it
                initReadline();
                await handleUserInput(sock);
                return;
            }
        }
        console.error('Error handling input:', error);
        await handleUserInput(sock);
    }
}

// start a connection
const startSock = async() => {
	const { state, saveCreds } = await useMultiFileAuthState('auth_info')
	// fetch latest version of WA Web
	const { version, isLatest } = await fetchLatestBaileysVersion()
	console.log(`using WA v${version.join('.')}, isLatest: ${isLatest}`)

	const sock = makeWASocket({
		version,
		logger,
		printQRInTerminal: true, // Keep this true for terminal display
		auth: {
			creds: state.creds,
			/** caching makes the store faster to send/recv messages */
			keys: makeCacheableSignalKeyStore(state.keys, logger),
		},
		msgRetryCounterCache,
		generateHighQualityLinkPreview: true,
		// ignore all broadcast messages -- to receive the same
		// comment the line below out
		// shouldIgnoreJid: jid => isJidBroadcast(jid),
		// implement to handle retries & poll updates
		getMessage,
	})

	store?.bind(sock.ev)

	// Handle QR code events
	sock.ev.on('connection.update', (update) => {
		const { connection, lastDisconnect, qr } = update
		
		if(qr) {
			// Generate QR in terminal
			qrcode.generate(qr, {small: true})
			
			// Convert QR to ASCII art for web display
			qrcode.generate(qr, { small: true }, (qrAscii) => {
				// If running in browser environment
				if (typeof window !== 'undefined') {
					window.postMessage({ type: 'qr', qr: qrAscii }, '*')
				}
			})
		}

		if(connection === 'connecting') {
			console.log('Connecting to WhatsApp...');
            if (typeof window !== 'undefined') {
                window.postMessage({ type: 'loading' }, '*')
            }
		}

		if(connection === 'close') {
			const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
            
            console.log('Connection closed. Status:', statusCode);
            
            if(statusCode !== DisconnectReason.loggedOut) {
                console.log('Reconnecting...');
                startSock().catch(err => {
                    console.error('Failed to restart connection:', err);
                });
            } else {
                console.log('Logged out of WhatsApp');
                if (typeof window !== 'undefined') {
                    window.postMessage({ 
                        type: 'error', 
                        message: 'Connection closed. You are logged out.'
                    }, '*')
                }
                // Close readline interface before exiting
                if (rl) {
                    rl.close();
                }
                process.exit(1);
            }
		} else if(connection === 'open') {
			console.log('Connected to WhatsApp');
            if (typeof window !== 'undefined') {
                window.postMessage({ 
                    type: 'status', 
                    status: 'Connected!',
                    timestamp: Date.now()
                }, '*')
            }
            // Show menu options after successful connection
            handleUserInput(sock).catch(console.error);
		}
	})

	// Pairing code for Web clients
	if (usePairingCode && !sock.authState.creds.registered) {
		// todo move to QR event
		const phoneNumber = await question('Please enter your phone number:\n')
		const code = await sock.requestPairingCode(phoneNumber)
		console.log(`Pairing code: ${code}`)
	}

	const sendMessageWTyping = async(msg: AnyMessageContent, jid: string) => {
		await sock.presenceSubscribe(jid)
		await delay(500)

		await sock.sendPresenceUpdate('composing', jid)
		await delay(2000)

		await sock.sendPresenceUpdate('paused', jid)

		await sock.sendMessage(jid, msg)
	}

	const startTest = async (sock: any, jid: string) => {
		console.log('Test started');
		// Add your test logic here
		await sock.sendMessage(jid, { text: 'Test message' });
		// await sock.sendMessage(jid, { image: { url: './path/to/image.jpg' }, caption: 'Test image' });
		// await sock.sendMessage(jid, { video: { url: './path/to/video.mp4' }, caption: 'Test video' });
		// await sock.sendMessage(jid, { document: { url: './path/to/document.pdf' }, mimetype: 'application/pdf', fileName: 'Test document' });
		// await sock.sendMessage(jid, { audio: { url: './path/to/audio.mp3' }, mimetype: 'audio/mp3' });
	    // await sock.sendMessage(jid, { location: { degreesLatitude: 37.7749, degreesLongitude: -122.4194 }, name: 'Test location' });
		// await sock.sendMessage(jid, { contact: { displayName: 'Test contact', vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN:Test Contact\nTEL;TYPE=CELL:1234567890\nEND:VCARD' } });
	}

	handleUserInput(sock);

	// the process function lets you process all events that just occurred
	// efficiently in a batch
	sock.ev.process(
		// events is a map for event name => event data
		async(events) => {
			// something about the connection changed
			// maybe it closed, or we received all offline message or connection opened
			if(events['connection.update']) {
				const update = events['connection.update']
				const { connection, lastDisconnect } = update
				if(connection === 'close') {
					// reconnect if not logged out
					if((lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut) {
						startSock()
					} else {
						console.log('Connection closed. You are logged out.')
					}
				}
				
				// WARNING: THIS WILL SEND A WAM EXAMPLE AND THIS IS A ****CAPTURED MESSAGE.****
				// DO NOT ACTUALLY ENABLE THIS UNLESS YOU MODIFIED THE FILE.JSON!!!!!
				// THE ANALYTICS IN THE FILE ARE OLD. DO NOT USE THEM.
				// YOUR APP SHOULD HAVE GLOBALS AND ANALYTICS ACCURATE TO TIME, DATE AND THE SESSION
				// THIS FILE.JSON APPROACH IS JUST AN APPROACH I USED, BE FREE TO DO THIS IN ANOTHER WAY.
				// THE FIRST EVENT CONTAINS THE CONSTANT GLOBALS, EXCEPT THE seqenceNumber(in the event) and commitTime
				// THIS INCLUDES STUFF LIKE ocVersion WHICH IS CRUCIAL FOR THE PREVENTION OF THE WARNING
				const sendWAMExample = false;
				if(connection === 'open' && sendWAMExample) {
					/// sending WAM EXAMPLE
					const {
						header: {
							wamVersion,
							eventSequenceNumber,
						},
						events,
					} = JSON.parse(await fs.promises.readFile("./boot_analytics_test.json", "utf-8"))

					const binaryInfo = new BinaryInfo({
						protocolVersion: wamVersion,
						sequence: eventSequenceNumber,
						events: events
					})

					const buffer = encodeWAM(binaryInfo);
					
					const result = await sock.sendWAMBuffer(buffer)
					console.log(result)
				}

				console.log('connection update', update)
			}

			// credentials updated -- save them
			if(events['creds.update']) {
				await saveCreds()
			}

			if(events['labels.association']) {
				console.log(events['labels.association'])
			}


			if(events['labels.edit']) {
				console.log(events['labels.edit'])
			}

			if(events.call) {
				console.log('recv call event', events.call)
			}

			// history received
			if(events['messaging-history.set']) {
				const { chats, contacts, messages, isLatest, progress, syncType } = events['messaging-history.set']
				if (syncType === proto.HistorySync.HistorySyncType.ON_DEMAND) {
					console.log('received on-demand history sync, messages=', messages)
				}
				console.log(`recv ${chats.length} chats, ${contacts.length} contacts, ${messages.length} msgs (is latest: ${isLatest}, progress: ${progress}%), type: ${syncType}`)
			}

			// received a new message
			if(events['messages.upsert']) {
				const upsert = events['messages.upsert']
				console.log('recv messages ', JSON.stringify(upsert, undefined, 2))

				if(upsert.type === 'notify') {
					for (const msg of upsert.messages) {
						//TODO: More built-in implementation of this
						/* if (
							msg.message?.protocolMessage?.type ===
							proto.Message.ProtocolMessage.Type.HISTORY_SYNC_NOTIFICATION
						  ) {
							const historySyncNotification = getHistoryMsg(msg.message)
							if (
							  historySyncNotification?.syncType ==
							  proto.HistorySync.HistorySyncType.ON_DEMAND
							) {
							  const { messages } =
								await downloadAndProcessHistorySyncNotification(
								  historySyncNotification,
								  {}
								)

								
								const chatId = onDemandMap.get(
									historySyncNotification!.peerDataRequestSessionId!
								)
								
								console.log(messages)

							  onDemandMap.delete(
								historySyncNotification!.peerDataRequestSessionId!
							  )

							  /*
								// 50 messages is the limit imposed by whatsapp
								//TODO: Add ratelimit of 7200 seconds
								//TODO: Max retries 10
								const messageId = await sock.fetchMessageHistory(
									50,
									oldestMessageKey,
									oldestMessageTimestamp
								)
								onDemandMap.set(messageId, chatId)
							}
						  } */

						if (msg.message?.conversation || msg.message?.extendedTextMessage?.text) {
							const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text
							if (text === "H") {
								await startTest(sock, msg.key.remoteJid!);
							}
							if (text == "requestPlaceholder" && !upsert.requestId) {
								const messageId = await sock.requestPlaceholderResend(msg.key) 
								console.log('requested placeholder resync, id=', messageId)
							} else if (upsert.requestId) {
								console.log('Message received from phone, id=', upsert.requestId, msg)
							}

							// go to an old chat and send this
							if (text == "onDemandHistSync") {
								const messageId = await sock.fetchMessageHistory(50, msg.key, msg.messageTimestamp!) 
								console.log('requested on-demand sync, id=', messageId)
							}
						}

						if(!msg.key.fromMe && doReplies && !isJidNewsletter(msg.key?.remoteJid!)) {

							console.log('replying to', msg.key.remoteJid)
							await sock!.readMessages([msg.key])
							await sendMessageWTyping({ text: 'Hello there!' }, msg.key.remoteJid!)
						}
					}
				}
			}

			// messages updated like status delivered, message deleted etc.
			if(events['messages.update']) {
				console.log(
					JSON.stringify(events['messages.update'], undefined, 2)
				)

				for(const { key, update } of events['messages.update']) {
					if(update.pollUpdates) {
						const pollCreation = await getMessage(key)
						if(pollCreation) {
							console.log(
								'got poll update, aggregation: ',
								getAggregateVotesInPollMessage({
									message: pollCreation,
									pollUpdates: update.pollUpdates,
								})
							)
						}
					}
				}
			}

			if(events['message-receipt.update']) {
				console.log(events['message-receipt.update'])
			}

			if(events['messages.reaction']) {
				console.log(events['messages.reaction'])
			}

			if(events['presence.update']) {
				console.log(events['presence.update'])
			}

			if(events['chats.update']) {
				console.log(events['chats.update'])
			}

			if(events['contacts.update']) {
				for(const contact of events['contacts.update']) {
					if(typeof contact.imgUrl !== 'undefined') {
						const newUrl = contact.imgUrl === null
							? null
							: await sock!.profilePictureUrl(contact.id!).catch(() => null)
						console.log(
							`contact ${contact.id} has a new profile pic: ${newUrl}`,
						)
					}
				}
			}

			if(events['chats.delete']) {
				console.log('chats deleted ', events['chats.delete'])
			}
		}
	)

	return sock

	async function getMessage(key: WAMessageKey): Promise<WAMessageContent | undefined> {
		if(store) {
			const msg = await store.loadMessage(key.remoteJid!, key.id!)
			return msg?.message || undefined
		}

		// only if store is present
		return proto.Message.fromObject({})
	}
}

// Initialize readline at start
initReadline();
startSock().catch(console.error);

// Add cleanup handler
process.on('SIGINT', () => {
    if (rl) {
        rl.close();
    }
    process.exit(0);
});

async function startTest(sock: any, jid: string) {
	console.log('Starting test sequence...');
	try {
		// Send text message
		await sock.sendMessage(jid, { text: 'Test message 1' });
		
		// Example: Send an image (commented out as it needs a valid path)
		// await sock.sendMessage(jid, { 
		//     image: { url: './test.jpg' }, 
		//     caption: 'Test image' 
		// });

		// Example: Send a simple poll
		await sock.sendMessage(jid, {
			poll: {
				name: 'Test poll',
				values: ['Option 1', 'Option 2', 'Option 3'],
				selectableCount: 1
			}
		});

		// Send a location
		await sock.sendMessage(jid, { 
			location: { 
				degreesLatitude: 0, 
				degreesLongitude: 0 
			},
			name: 'Test location'
		});

		console.log('Test sequence completed successfully');
	} catch (error) {
		console.error('Error during test:', error);
	}
}
