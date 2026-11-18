import {useEffect} from 'react';
import {create} from 'zustand';
import {GetClipboardWatchStatus, StartClipboardWatch, StopClipboardWatch} from '../../wailsjs/go/main/App';
import {EventsOn} from '../../wailsjs/runtime/runtime';
import {useDeviceStore} from '../store/deviceStore';
import {useLanguageStore} from '../i18n';

export const useClipboardWatchStore = create(() => ({serial: '', state: 'off', error: ''}));
const selectedSerial = () => useDeviceStore.getState().selectedDevice?.id;

// Wails calls can finish out of order. Finish stopping the previous listener before
// starting the currently selected device, including on a quick disconnect/reconnect.
let pending = Promise.resolve();
let selectionRevision = 0;
let statusRevision = 0;
function followSelection(serial?: string, previous?: string) {
    const selection = ++selectionRevision;
    pending = pending.then(async () => {
        if (previous) await StopClipboardWatch(previous);
        if (serial && selection === selectionRevision && selectedSerial() === serial) await StartClipboardWatch(serial);
    }).catch(error => {
        if (serial && selection === selectionRevision && selectedSerial() === serial) {
            statusRevision++;
            useClipboardWatchStore.setState({serial, state: 'error', error: String(error)});
        }
    });
}

export function retryClipboardWatch() {
    followSelection(selectedSerial());
}

// The root follows device selection independently of the visible page.
export function useClipboardWatch() {
    useEffect(() => {
        const refresh = async () => {
            const request = ++statusRevision;
            try {
                const status = await GetClipboardWatchStatus();
                if (request === statusRevision) useClipboardWatchStore.setState(status);
            } catch (error) {
                const serial = selectedSerial();
                if (request === statusRevision && serial) {
                    useClipboardWatchStore.setState({serial, state: 'error', error: String(error)});
                }
            }
        };
        const offStatus = EventsOn('clipboard-watch-updated', refresh);
        const offLanguage = useLanguageStore.subscribe((next, previous) => {
            if (next.resolved !== previous.resolved && useClipboardWatchStore.getState().state === 'error') void refresh();
        });
        const offDevice = useDeviceStore.subscribe((next, previous) => {
            const nextId = next.selectedDevice?.id;
            const previousId = previous.selectedDevice?.id;
            if (nextId !== previousId) followSelection(nextId, previousId);
        });
        void refresh();
        followSelection(selectedSerial());
        return () => {
            statusRevision++;
            offStatus();
            offLanguage();
            offDevice();
            followSelection(undefined, selectedSerial());
        };
    }, []);
}
