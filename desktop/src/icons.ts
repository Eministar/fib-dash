// Offizielle Fluent-System-Icons (wie in Windows 11), als SVG-Text eingebunden.
import home from '@fluentui/svg-icons/icons/home_24_regular.svg?raw'
import videoClip from '@fluentui/svg-icons/icons/video_clip_24_regular.svg?raw'
import timer from '@fluentui/svg-icons/icons/timer_24_regular.svg?raw'
import documentSearch from '@fluentui/svg-icons/icons/document_search_24_regular.svg?raw'
import settings from '@fluentui/svg-icons/icons/settings_24_regular.svg?raw'
import open from '@fluentui/svg-icons/icons/open_24_regular.svg?raw'
import record from '@fluentui/svg-icons/icons/record_24_regular.svg?raw'
import folderOpen from '@fluentui/svg-icons/icons/folder_open_24_regular.svg?raw'
import keyboard from '@fluentui/svg-icons/icons/keyboard_24_regular.svg?raw'
import play from '@fluentui/svg-icons/icons/play_24_filled.svg?raw'
import pause from '@fluentui/svg-icons/icons/pause_24_filled.svg?raw'
import cut from '@fluentui/svg-icons/icons/cut_24_regular.svg?raw'
import arrowUpload from '@fluentui/svg-icons/icons/arrow_upload_24_regular.svg?raw'
import arrowReset from '@fluentui/svg-icons/icons/arrow_reset_24_regular.svg?raw'
import arrowSync from '@fluentui/svg-icons/icons/arrow_sync_24_regular.svg?raw'
import search from '@fluentui/svg-icons/icons/search_24_regular.svg?raw'
import signOut from '@fluentui/svg-icons/icons/sign_out_24_regular.svg?raw'
import person from '@fluentui/svg-icons/icons/person_24_regular.svg?raw'
import peopleTeam from '@fluentui/svg-icons/icons/people_team_24_regular.svg?raw'
import dismiss from '@fluentui/svg-icons/icons/dismiss_24_regular.svg?raw'
import windowNew from '@fluentui/svg-icons/icons/window_new_24_regular.svg?raw'
import edit from '@fluentui/svg-icons/icons/edit_24_regular.svg?raw'
import personSwap from '@fluentui/svg-icons/icons/person_swap_24_regular.svg?raw'
import deleteIcon from '@fluentui/svg-icons/icons/delete_24_regular.svg?raw'
import chevronRight from '@fluentui/svg-icons/icons/chevron_right_24_regular.svg?raw'
import add from '@fluentui/svg-icons/icons/add_24_regular.svg?raw'
import personAdd from '@fluentui/svg-icons/icons/person_add_24_regular.svg?raw'
import link from '@fluentui/svg-icons/icons/link_24_regular.svg?raw'
import vehicle from '@fluentui/svg-icons/icons/vehicle_car_24_regular.svg?raw'
import box from '@fluentui/svg-icons/icons/box_24_regular.svg?raw'
import history from '@fluentui/svg-icons/icons/history_24_regular.svg?raw'
import image from '@fluentui/svg-icons/icons/image_24_regular.svg?raw'
import target from '@fluentui/svg-icons/icons/target_24_regular.svg?raw'
import stop from '@fluentui/svg-icons/icons/stop_24_filled.svg?raw'
import screenshot from '@fluentui/svg-icons/icons/screenshot_24_regular.svg?raw'
import checkmarkCircle from '@fluentui/svg-icons/icons/checkmark_circle_24_regular.svg?raw'
import errorCircle from '@fluentui/svg-icons/icons/error_circle_24_regular.svg?raw'
import cloudUpload from '@fluentui/svg-icons/icons/cloud_arrow_up_24_regular.svg?raw'
import filmstrip from '@fluentui/svg-icons/icons/filmstrip_24_regular.svg?raw'
import wrench from '@fluentui/svg-icons/icons/wrench_24_regular.svg?raw'
import keyboard2 from '@fluentui/svg-icons/icons/keyboard_24_regular.svg?raw'
import cursor from '@fluentui/svg-icons/icons/cursor_24_regular.svg?raw'
import board from '@fluentui/svg-icons/icons/developer_board_24_regular.svg?raw'
import games from '@fluentui/svg-icons/icons/games_24_regular.svg?raw'
import warning from '@fluentui/svg-icons/icons/warning_24_regular.svg?raw'
import shieldError from '@fluentui/svg-icons/icons/shield_error_24_regular.svg?raw'
import arrowUndo from '@fluentui/svg-icons/icons/arrow_undo_24_regular.svg?raw'
import info from '@fluentui/svg-icons/icons/info_24_regular.svg?raw'
import gauge from '@fluentui/svg-icons/icons/gauge_24_regular.svg?raw'
import imageOff from '@fluentui/svg-icons/icons/image_off_24_regular.svg?raw'

export const icons = {
  home, videoClip, timer, documentSearch, settings, open, record, folderOpen, keyboard, play, pause, cut,
  arrowUpload, arrowReset, arrowSync, search, signOut, person, peopleTeam, dismiss, windowNew,
  edit, personSwap, delete: deleteIcon, chevronRight, add, personAdd, link, vehicle, box, history, image, imageOff,
  target, stop, screenshot, checkmarkCircle, errorCircle, cloudUpload, filmstrip,
  wrench, wasd: keyboard2, cursor, board, games, warning, shieldError, arrowUndo, info, gauge,
}

export type IconName = keyof typeof icons

/** Ersetzt jedes `<i data-icon="name">` durch das passende SVG (erbt Farbe und Größe). */
export function renderIcons(root: ParentNode = document) {
  for (const el of root.querySelectorAll<HTMLElement>('i[data-icon]')) {
    const svg = icons[el.dataset.icon as IconName]
    if (svg) el.innerHTML = svg.replace('<svg ', '<svg aria-hidden="true" fill="currentColor" ')
  }
}

export function icon(name: IconName) {
  return `<i class="icon" data-icon="${name}">${icons[name].replace('<svg ', '<svg aria-hidden="true" fill="currentColor" ')}</i>`
}
