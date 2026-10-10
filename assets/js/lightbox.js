// Click a post image to open it in a fullscreen <dialog>, click it again to
// zoom in and out. The dialog itself handles Esc-to-close and focus.
;(function () {
	// Figures that link somewhere (figure > a > img) keep behaving as links.
	var thumbs = document.querySelectorAll('.postWrapper figure > img')
	var dialog = document.createElement('dialog')
	if (!thumbs.length || !dialog.showModal) return

	// Focus starts on the stage rather than the close button, which would
	// otherwise open with a focus ring. Where the browser scrolls a focused
	// element from the keyboard, the arrow keys also pan a zoomed image.
	dialog.className = 'lightbox'
	dialog.innerHTML =
		'<div class="lightbox__stage" tabindex="-1" autofocus><img class="lightbox__image" alt="" draggable="false"></div>' +
		'<button class="lightbox__close" type="button" aria-label="Close image">[ x ]</button>'
	document.body.appendChild(dialog)

	var stage = dialog.querySelector('.lightbox__stage')
	var image = dialog.querySelector('.lightbox__image')
	var drag = null
	var dragged = false

	function isZoomed() {
		return dialog.classList.contains('is-zoomed')
	}

	// The stylesheet fits the image to the screen, and needs the aspect ratio
	// to turn the height limit into a width limit.
	function setRatio(img) {
		if (img.naturalHeight) {
			dialog.style.setProperty(
				'--lightbox-ratio',
				img.naturalWidth / img.naturalHeight,
			)
		}
	}

	// Full resolution, or 2x for images that already fit on screen. The point
	// that was clicked stays under the cursor.
	function zoomIn(e) {
		var before = image.getBoundingClientRect()
		var x = (e.clientX - before.left) / before.width
		var y = (e.clientY - before.top) / before.height

		image.style.width = Math.max(image.naturalWidth, before.width * 2) + 'px'
		dialog.classList.add('is-zoomed')

		var after = image.getBoundingClientRect()
		stage.scrollLeft += after.left + x * after.width - e.clientX
		stage.scrollTop += after.top + y * after.height - e.clientY
	}

	function zoomOut() {
		dialog.classList.remove('is-zoomed')
		image.style.width = ''
	}

	// One listener per image instead of one on the document: iOS Safari only
	// turns a tap on a plain element into a click if the listener is on it.
	thumbs.forEach(function (img) {
		img.addEventListener('click', function () {
			image.src = img.currentSrc || img.src
			image.alt = img.alt
			setRatio(img)
			dialog.showModal()
		})
	})

	image.addEventListener('load', function () {
		setRatio(image)
	})

	dialog.addEventListener('close', zoomOut)

	dialog.addEventListener('click', function (e) {
		// The click that ends a pan shouldn't zoom out or close.
		if (dragged) return

		if (e.target !== image) dialog.close()
		else if (isZoomed()) zoomOut()
		else zoomIn(e)
	})

	// Drag to pan while zoomed. Touch screens pan with native scrolling.
	dialog.addEventListener('mousedown', function (e) {
		dragged = false
		if (e.target !== image || e.button !== 0 || !isZoomed()) return

		e.preventDefault()
		drag = {
			x: e.clientX,
			y: e.clientY,
			left: stage.scrollLeft,
			top: stage.scrollTop,
		}
	})

	window.addEventListener('mousemove', function (e) {
		if (!drag) return

		var dx = e.clientX - drag.x
		var dy = e.clientY - drag.y
		if (Math.abs(dx) + Math.abs(dy) > 4) {
			dragged = true
			dialog.classList.add('is-dragging')
		}
		stage.scrollLeft = drag.left - dx
		stage.scrollTop = drag.top - dy
	})

	window.addEventListener('mouseup', function () {
		drag = null
		dialog.classList.remove('is-dragging')
	})
})()
