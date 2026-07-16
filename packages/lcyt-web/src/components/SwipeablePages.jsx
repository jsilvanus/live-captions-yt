import { useState, useRef, useEffect } from 'react';

export function SwipeablePages({ pages, isNarrow, onPageChange }) {
  const [currentPage, setCurrentPage] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartX, setDragStartX] = useState(0);
  const [translateX, setTranslateX] = useState(0);
  const containerRef = useRef(null);

  if (!isNarrow) {
    return <>{pages.map((page, i) => page.content)}</>;
  }

  function handleTouchStart(e) {
    setIsDragging(true);
    setDragStartX(e.touches[0].clientX);
  }

  function handleTouchMove(e) {
    if (!isDragging) return;
    const currentX = e.touches[0].clientX;
    const diff = currentX - dragStartX;
    setTranslateX(diff);
  }

  function handleTouchEnd(e) {
    setIsDragging(false);
    const diff = dragStartX - (e.changedTouches[0]?.clientX || dragStartX);
    const threshold = 50;

    if (Math.abs(diff) > threshold) {
      if (diff > 0 && currentPage < pages.length - 1) {
        goToPage(currentPage + 1);
      } else if (diff < 0 && currentPage > 0) {
        goToPage(currentPage - 1);
      } else {
        setTranslateX(0);
      }
    } else {
      setTranslateX(0);
    }
  }

  function goToPage(page) {
    setCurrentPage(page);
    setTranslateX(0);
    onPageChange?.(page);
  }

  return (
    <div
      ref={containerRef}
      className="swipeable-container"
      style={{
        display: 'flex',
        overflow: 'hidden',
        position: 'relative',
        width: '100%',
        height: '100%',
        flex: 1,
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {pages.map((page, i) => (
        <div
          key={i}
          className={`swipeable-page ${i === currentPage ? 'swipeable-page--active' : ''}`}
          style={{
            width: '100%',
            height: '100%',
            flex: '0 0 100%',
            transform: `translateX(calc(${(i - currentPage) * 100}% + ${isDragging && i === currentPage ? translateX : 0}px))`,
            transition: isDragging ? 'none' : 'transform 0.3s ease-out',
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {page.content}
        </div>
      ))}

      {/* Page indicators */}
      <div className="swipeable-indicators" style={{
        position: 'absolute',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: 8,
        zIndex: 10,
      }}>
        {pages.map((page, i) => (
          <button
            key={i}
            className={`swipeable-indicator ${i === currentPage ? 'swipeable-indicator--active' : ''}`}
            onClick={() => goToPage(i)}
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              border: 'none',
              cursor: 'pointer',
              background: i === currentPage ? 'var(--color-accent)' : 'var(--color-text-muted)',
              opacity: i === currentPage ? 1 : 0.4,
              transition: 'all 0.2s ease',
              padding: 0,
            }}
            aria-label={`Go to page ${i + 1}`}
          />
        ))}
      </div>
    </div>
  );
}
